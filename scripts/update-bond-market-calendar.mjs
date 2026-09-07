import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../data/bond-market-calendar.json');
const USER_AGENT = 'Mozilla/5.0 (compatible; BondStatsCalendar/1.0; +https://www.bondstats.org/)';
const NOW = new Date();
const TODAY = NOW.toISOString().slice(0, 10);
const WINDOW_END = new Date(NOW.getTime() + 400 * 86400000);

const SOURCES = {
  fed: { name: 'Federal Reserve', url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm' },
  ecb: { name: 'European Central Bank', url: 'https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html' },
  boe: { name: 'Bank of England', url: 'https://www.bankofengland.co.uk/monetary-policy/upcoming-mpc-dates' },
  boj: { name: 'Bank of Japan', url: 'https://www.boj.or.jp/en/mopo/mpmsche_minu/' },
  bls: { name: 'U.S. Bureau of Labor Statistics', url: 'https://www.bls.gov/schedule/news_release/bls.ics' },
  'treasury-auctions': { name: 'U.S. Treasury Auctions', url: 'https://www.treasurydirect.gov/TA_WS/securities/announced?format=json&days=90' },
  'treasury-refunding': { name: 'U.S. Treasury Quarterly Refunding', url: 'https://home.treasury.gov/policy-issues/financing-the-government/quarterly-refunding/most-recent-quarterly-refunding-documents' }
};

const MONTHS = {
  jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,
  jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12
};

function decodeHtml(s='') {
  return s.replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&ndash;|&#8211;/gi,'–').replace(/&mdash;|&#8212;/gi,'—').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');
}
function htmlToText(html='') {
  return decodeHtml(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<br\s*\/?>/gi,'\n')
    .replace(/<\/(p|div|li|tr|h1|h2|h3|h4|section)>/gi,'\n')
    .replace(/<[^>]+>/g,' ')
    .replace(/[\t ]+/g,' ')
    .replace(/\n\s*\n+/g,'\n')
    .trim();
}
function isoDate(y,m,d){ return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
function parseEnglishDate(s='') {
  const m = s.trim().match(/([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(20\d{2})/);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  return month ? isoDate(Number(m[3]), month, Number(m[2])) : null;
}
function getTimeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'
  }).formatToParts(date).reduce((a,p)=>(a[p.type]=p.value,a),{});
  const asUtc = Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second);
  return asUtc - date.getTime();
}
function zonedToUtc(dateStr, timeStr, timeZone) {
  if (!dateStr || !timeStr) return null;
  const [y,m,d] = dateStr.split('-').map(Number);
  const [hh,mm] = timeStr.split(':').map(Number);
  const localAsUtc = Date.UTC(y,m-1,d,hh,mm,0);
  let probe = new Date(localAsUtc);
  let utc = new Date(localAsUtc - getTimeZoneOffsetMs(probe,timeZone));
  utc = new Date(localAsUtc - getTimeZoneOffsetMs(utc,timeZone));
  return utc.toISOString();
}
function inferYear(month, day) {
  const nowY = NOW.getUTCFullYear(), nowM = NOW.getUTCMonth()+1;
  let year = nowY;
  if (month < nowM - 2) year += 1;
  const test = new Date(`${isoDate(year,month,day)}T12:00:00Z`);
  if (test < new Date(NOW.getTime() - 35*86400000)) year += 1;
  return year;
}
function cleanId(s='') { return s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
function baseEvent({sourceId,date,time=null,timeZone='UTC',timeLabel='Time varies',title,category,region,impact='high',sourceUrl,whyItMatters,meta={}}) {
  return {
    id: `${sourceId}-${cleanId(title)}-${date}`,
    sourceId,date,time,timeZone,timeLabel,
    datetimeUtc: time ? zonedToUtc(date,time,timeZone) : null,
    title,category,region,impact,
    sourceName: SOURCES[sourceId]?.name || sourceId,
    sourceUrl: sourceUrl || SOURCES[sourceId]?.url || '',
    whyItMatters, meta
  };
}
function inWindow(e) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(e.date || '')) return false;
  const d = new Date(`${e.date}T23:59:59Z`);
  return d >= new Date(NOW.getTime()-2*86400000) && d <= WINDOW_END;
}
function dedupe(events) {
  const seen = new Set();
  return events.filter(inWindow).sort((a,b)=>`${a.date}T${a.time||'12:00'}`.localeCompare(`${b.date}T${b.time||'12:00'}`)).filter(e=>{
    const k = `${e.sourceId}|${e.title}|${e.date}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  });
}
async function fetchText(url, attempts=2) {
  let last;
  for (let i=0;i<attempts;i++) {
    try {
      const r = await fetch(url,{headers:{'user-agent':USER_AGENT,'accept':'text/html,application/json,text/calendar;q=0.9,*/*;q=0.8'},signal:AbortSignal.timeout(10000)});
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return await r.text();
    } catch (e) { last=e; await new Promise(r=>setTimeout(r,500*(i+1))); }
  }
  throw last;
}

async function parseFed() {
  const html = await fetchText(SOURCES.fed.url);
  const text = htmlToText(html);
  const re = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:-(\d{1,2}))?\s+FOMC Meeting\b/gi;
  const out=[]; let m;
  while ((m=re.exec(text))) {
    const month=MONTHS[m[1].toLowerCase()], day=Number(m[3]||m[2]); if(!month) continue;
    const year=inferYear(month,day), date=isoDate(year,month,day);
    out.push(baseEvent({sourceId:'fed',date,time:'14:00',timeZone:'America/New_York',timeLabel:'14:00 ET',title:'FOMC Rate Decision',category:'Central Banks',region:'United States',impact:'critical',sourceUrl:'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',whyItMatters:'The FOMC decision directly reprices the expected policy path, front-end Treasury yields and the shape of the global yield curve.'}));
  }
  if (!out.length) throw new Error('No upcoming FOMC meetings parsed');
  return out;
}

async function parseEcb() {
  const text = htmlToText(await fetchText(SOURCES.ecb.url));
  const out=[]; const re=/(\d{2})\/(\d{2})\/(20\d{2})\s+([\s\S]*?)(?=\d{2}\/\d{2}\/20\d{2}|$)/g; let m;
  while((m=re.exec(text))){
    const desc=m[4].replace(/\s+/g,' ').trim();
    if(!/monetary policy meeting/i.test(desc) || !/(Day 2|followed by press conference)/i.test(desc)) continue;
    const date=isoDate(Number(m[3]),Number(m[2]),Number(m[1]));
    out.push(baseEvent({sourceId:'ecb',date,time:'14:15',timeZone:'Europe/Brussels',timeLabel:'14:15 CET/CEST',title:'ECB Monetary Policy Decision',category:'Central Banks',region:'Euro Area',impact:'critical',whyItMatters:'Changes in the ECB policy path can reprice Bund yields, euro-area curves, sovereign spreads and global duration.'}));
  }
  if(!out.length) throw new Error('No ECB monetary-policy meetings parsed');
  return out;
}

async function parseBoe() {
  const text=htmlToText(await fetchText(SOURCES.boe.url));
  const out=[]; const re=/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})/gi; let m;
  while((m=re.exec(text))){
    const context=text.slice(Math.max(0,m.index-180),Math.min(text.length,re.lastIndex+220));
    if(!/(MPC|Monetary Policy)/i.test(context)) continue;
    const date=isoDate(Number(m[3]),MONTHS[m[2].toLowerCase()],Number(m[1]));
    out.push(baseEvent({sourceId:'boe',date,time:'12:00',timeZone:'Europe/London',timeLabel:'12:00 London',title:'Bank of England Rate Decision',category:'Central Banks',region:'United Kingdom',impact:'critical',whyItMatters:'Bank Rate decisions move gilt yields, sterling rates and expectations for the UK inflation-policy trade-off.'}));
  }
  const unique=dedupe(out);
  if(!unique.length) throw new Error('No BoE MPC dates parsed');
  return unique;
}

async function parseBoj() {
  const html=await fetchText(SOURCES.boj.url);
  const out=[]; const sec=/<h2[^>]*>\s*(20\d{2})\s*<\/h2>([\s\S]*?)(?=<h2[^>]*>|$)/gi; let sm;
  while((sm=sec.exec(html))){
    const year=Number(sm[1]);
    for(const row of sm[2].split(/<tr\b[^>]*>/i).slice(1)){
      const text=htmlToText(row).replace(/\s+/g,' ').trim();
      const m=text.match(/^([A-Za-z]+)\.?\s+(\d{1,2})\s*\([^)]*\)\s*,\s*(\d{1,2})\s*\([^)]*\)/);
      if(!m) continue;
      const month=MONTHS[m[1].toLowerCase()]; if(!month) continue;
      const date=isoDate(year,month,Number(m[3]));
      out.push(baseEvent({sourceId:'boj',date,time:null,timeZone:'Asia/Tokyo',timeLabel:'Time varies',title:'Bank of Japan Monetary Policy Decision',category:'Central Banks',region:'Japan',impact:'critical',whyItMatters:'BoJ decisions can trigger sharp moves in JGB yields, the yen and global term premia because Japan is a major source of cross-border capital.'}));
    }
  }
  if(!out.length) throw new Error('No BoJ MPM dates parsed');
  return out;
}

function parseIcsDate(line) {
  const [lhs,valueRaw=''] = line.split(':'); const value=valueRaw.trim();
  const tz=(lhs.match(/TZID=([^;:]+)/i)||[])[1] || (value.endsWith('Z')?'UTC':'America/New_York');
  const m=value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?Z?$/); if(!m) return null;
  const date=isoDate(+m[1],+m[2],+m[3]), time=m[4]?`${m[4]}:${m[5]}`:null;
  const datetimeUtc=value.endsWith('Z') && time ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]||'00'}Z`).toISOString() : (time?zonedToUtc(date,time,tz):null);
  return {date,time,timeZone:tz,datetimeUtc};
}
async function parseBls() {
  let ics=await fetchText(SOURCES.bls.url); ics=ics.replace(/\r?\n[ \t]/g,'');
  const out=[];
  for(const block of ics.split('BEGIN:VEVENT').slice(1)){
    const lines=block.split(/\r?\n/); const summary=(lines.find(x=>x.startsWith('SUMMARY:'))||'').slice(8).replace(/\\,/g,',').trim();
    const dtLine=lines.find(x=>x.startsWith('DTSTART')); if(!dtLine) continue;
    const dt=parseIcsDate(dtLine); if(!dt) continue;
    let title,category,impact='critical',why,sourceUrl;
    if(/Consumer Price Index/i.test(summary)){ title='U.S. Consumer Price Index'; category='Inflation'; sourceUrl='https://www.bls.gov/schedule/news_release/cpi.htm'; why='Inflation surprises can change the expected Fed path, real yields, breakevens and the front end of the Treasury curve within seconds.'; }
    else if(/Employment Situation/i.test(summary)){ title='U.S. Employment Situation / Nonfarm Payrolls'; category='Labour'; sourceUrl='https://www.bls.gov/schedule/news_release/empsit.htm'; why='Payrolls, unemployment and wage growth can rapidly alter expectations for Fed policy and front-end Treasury yields.'; }
    else continue;
    const e=baseEvent({sourceId:'bls',date:dt.date,time:dt.time||'08:30',timeZone:dt.timeZone||'America/New_York',timeLabel:`${dt.time||'08:30'} ET`,title,category,region:'United States',impact,sourceUrl,whyItMatters:why});
    if(dt.datetimeUtc) e.datetimeUtc=dt.datetimeUtc;
    out.push(e);
  }
  if(!out.length) throw new Error('No CPI/NFP events parsed from BLS ICS');
  return out;
}

async function parseTreasuryAuctions() {
  const raw=await fetchText(SOURCES['treasury-auctions'].url); const rows=JSON.parse(raw); const out=[];
  for(const x of Array.isArray(rows)?rows:[]){
    const type=String(x.securityType||''); const term=String(x.securityTerm||x.securityTermWeekYear||'').trim();
    if(!/(Note|Bond|TIPS)/i.test(type)) continue;
    const date=String(x.auctionDate||'').slice(0,10); if(!/^20\d{2}-\d{2}-\d{2}$/.test(date)) continue;
    const label=`U.S. Treasury ${term || type} ${/reopen/i.test(String(x.reopening||''))?'Reopening ':''}Auction`.replace(/\s+/g,' ').trim();
    const isLong=/(10|20|30)[- ]?Year/i.test(term); const isFront=/(2|3|5|7)[- ]?Year/i.test(term);
    out.push(baseEvent({sourceId:'treasury-auctions',date,time:'13:00',timeZone:'America/New_York',timeLabel:'13:00 ET',title:label,category:'Treasury',region:'United States',impact:isLong?'high':(isFront?'medium':'medium'),sourceUrl:'https://www.treasurydirect.gov/auctions/upcoming/',whyItMatters:isLong?'Long-duration Treasury auctions can move term premium and the long end through demand, auction tails and indirect-bidder participation.':'Coupon auctions reveal real-time demand for Treasury supply and can affect yields around the auction close.',meta:{cusip:x.cusip||null,offeringAmount:x.offeringAmount||null,reopening:x.reopening||null}}));
  }
  if(!out.length) throw new Error('No coupon Treasury auctions parsed');
  return out;
}

async function parseTreasuryRefunding() {
  const text=htmlToText(await fetchText(SOURCES['treasury-refunding'].url)).replace(/\s+/g,' '); const out=[];
  const first=text.match(/DOCUMENTS RELEASED at 3:00 PM[\s\S]*?next release is scheduled for ([A-Za-z]+ \d{1,2}, 20\d{2})/i);
  const second=text.match(/DOCUMENTS RELEASED at 8:30 AM[\s\S]*?next release is scheduled for ([A-Za-z]+ \d{1,2}, 20\d{2})/i);
  if(first){ const date=parseEnglishDate(first[1]); if(date) out.push(baseEvent({sourceId:'treasury-refunding',date,time:'15:00',timeZone:'America/New_York',timeLabel:'15:00 ET',title:'U.S. Treasury Borrowing Estimate',category:'Treasury',region:'United States',impact:'high',whyItMatters:'Borrowing estimates shape expectations for future Treasury supply and can move term premium, curve steepness and dealer balance-sheet expectations.'})); }
  if(second){ const date=parseEnglishDate(second[1]); if(date) out.push(baseEvent({sourceId:'treasury-refunding',date,time:'08:30',timeZone:'America/New_York',timeLabel:'08:30 ET',title:'U.S. Treasury Quarterly Refunding Announcement',category:'Treasury',region:'United States',impact:'critical',whyItMatters:'Refunding decisions reveal coupon-auction sizes and funding strategy, directly influencing Treasury supply expectations and the long end of the curve.'})); }
  if(!out.length) throw new Error('No upcoming Treasury refunding dates parsed');
  return out;
}

let prior={events:[],sources:[]};
try { prior=JSON.parse(await readFile(OUT,'utf8')); } catch {}
const parsers={fed:parseFed,ecb:parseEcb,boe:parseBoe,boj:parseBoj,bls:parseBls,'treasury-auctions':parseTreasuryAuctions,'treasury-refunding':parseTreasuryRefunding};
const results = await Promise.all(Object.entries(parsers).map(async ([id,parser]) => {
  try{
    const fresh=dedupe(await parser());
    if(!fresh.length) throw new Error('Parsed zero events in active window');
    return {events:fresh,source:{id,name:SOURCES[id].name,status:'ok',url:SOURCES[id].url,eventCount:fresh.length,checkedAt:new Date().toISOString()}};
  }catch(error){
    const fallback=dedupe((prior.events||[]).filter(e=>e.sourceId===id));
    return {events:fallback,source:{id,name:SOURCES[id].name,status:fallback.length?'fallback':'error',url:SOURCES[id].url,eventCount:fallback.length,checkedAt:new Date().toISOString(),message:String(error?.message||error).slice(0,220)}};
  }
}));
const events=results.flatMap(r=>r.events);
const sources=results.map(r=>r.source);
const finalEvents=dedupe(events);
const status=sources.every(s=>s.status==='ok')?'live':sources.some(s=>s.status==='ok')?'live-with-fallbacks':'fallback';
const payload={version:1,generatedAt:new Date().toISOString(),status,windowDays:400,sources,events:finalEvents};
await mkdir(dirname(OUT),{recursive:true});
await writeFile(OUT,JSON.stringify(payload,null,2)+'\n','utf8');
console.log(`Bond Market Calendar: ${finalEvents.length} events; status=${status}`);
for(const s of sources) console.log(`${s.status.padEnd(8)} ${s.id}: ${s.eventCount}`);

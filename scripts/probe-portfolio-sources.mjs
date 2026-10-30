// Read-only checks of the exact public providers used by the portfolio adapter.
const urls = [
  'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv',
  'https://nsearchives.nseindia.com/content/RSS/Online_announcements.xml',
  'https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=RELIANCE&from_date=01-10-2026&to_date=30-10-2026',
  'https://www.bseindia.com/data/xml/announcements.aspx',
  'https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?pageno=1&strCat=-1&strPrevDate=20261001&strScrip=500325&strSearch=P&strToDate=20261030&strType=C&subcategory=-1',
  'https://query1.finance.yahoo.com/v8/finance/chart/TCS.NS?range=3mo&interval=1d&events=splits',
];
await Promise.all(urls.map(async url => {
  try {
    const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0','Referer':'https://www.nseindia.com/'},signal:AbortSignal.timeout(16000)});
    const text=await r.text();
    console.log(JSON.stringify({url,status:r.status,length:text.length,sample:text.slice(0,850)}));
    if(url.endsWith('EQUITY_L.csv')&&r.ok){
      const wanted=new Set(['RELIANCE','TCS','HDFCBANK','HINDUNILVR','SUNPHARMA','MARUTI','LT','ULTRACEMCO','TATASTEEL','NTPC','BHARTIARTL','INDHOTEL','CONCOR','PIIND','POLYCAB','CDSL','MAPMYINDIA','FINEORG','KSCL','APOLLOHOSP']);
      console.log('VERIFIED DIRECTORY ROWS\n'+text.split('\n').filter(row=>wanted.has(row.split(',')[0])).join('\n'));
    }
  } catch(e){console.log(JSON.stringify({url,error:e.message}));}
}));

export type Company = {ticker:string; name:string; sector:string; isin:string; exchange:"NSE"; priceSymbol:string};
// Identity verified against NSE's EQUITY_L.csv on 2026-10-30. Sectors describe
// the business; they are not investment recommendations or market-cap rankings.
const rows = [
  ["RELIANCE","Reliance Industries","Diversified energy & retail","INE002A01018"],
  ["TCS","Tata Consultancy Services","IT services","INE467B01029"],
  ["HDFCBANK","HDFC Bank","Banking","INE040A01034"],
  ["HINDUNILVR","Hindustan Unilever","Household & personal care","INE030A01027"],
  ["SUNPHARMA","Sun Pharmaceutical Industries","Pharmaceuticals","INE044A01036"],
  ["MARUTI","Maruti Suzuki India","Passenger vehicles","INE585B01010"],
  ["LT","Larsen & Toubro","Engineering & construction","INE018A01030"],
  ["ULTRACEMCO","UltraTech Cement","Cement","INE481G01011"],
  ["TATASTEEL","Tata Steel","Steel","INE081A01020"],
  ["NTPC","NTPC","Electricity generation","INE733E01010"],
  ["BHARTIARTL","Bharti Airtel","Telecommunications","INE397D01024"],
  ["INDHOTEL","Indian Hotels Company","Hospitality","INE053A01029"],
  ["CONCOR","Container Corporation of India","Freight & logistics","INE111A01025"],
  ["PIIND","PI Industries","Agrochemicals","INE603J01030"],
  ["POLYCAB","Polycab India","Cables & electrical equipment","INE455K01017"],
  ["CDSL","Central Depository Services (India)","Securities depository","INE736A01011"],
  ["MAPMYINDIA","C.E. Info Systems","Geospatial technology","INE0BV301023"],
  ["FINEORG","Fine Organic Industries","Specialty chemical additives","INE686Y01026"],
  ["KSCL","Kaveri Seed Company","Seeds & agriculture","INE455I01029"],
  ["APOLLOHOSP","Apollo Hospitals Enterprise","Healthcare services","INE437A01024"],
];
export const companies:Company[]=rows.map(([ticker,name,sector,isin])=>({ticker,name,sector,isin,exchange:"NSE",priceSymbol:`${ticker}.NS`}));
export const directorySource="https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv";
export const companyByTicker=(ticker:string)=>companies.find(c=>c.ticker===ticker);

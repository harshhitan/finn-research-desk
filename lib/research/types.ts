export type ResearchCompany={ticker:string;name:string;isin:string;sources:string[];status:string;error:string|null;updated_at:string;annuals?:number;transcripts?:number;chunks?:number};
export type ResearchDocument={id:string;ticker:string;title:string;type:"annual_report"|"earnings_call";period:string;source_url:string;active_version:string|null;status:string;error:string|null;page_count?:number;readable_pages?:number;chunk_count?:number;updated_at:string};
export type ResearchPassage={id:string;document_id:string;ticker:string;page:number;heading:string;text:string;title:string;period:string;type:string;source_url:string;version_id:string};
export type ResearchFilters={period?:string;types?:string[]};
export type ResearchFinding={text:string;citations:{chunkId:string;quote:string}[];calculationIds?:string[]};
export type ResearchCalculation={id:string;label:string;formula:string;values:{label:string;value:string;unit:string}[];inputs:{factId:string;metric:string;value:string;unit:string;period:string;scope:string;sourceIds:string[]}[];sourceIds:string[]};
export type ResearchWorkflow={version:string;stage:string;objective?:string;rounds:number;steps:{tool:string;status:string;detail:string}[];calculations:ResearchCalculation[]};
export type ResearchUsage={inputTokens:number;outputTokens:number;cachedInputTokens:number;reasoningOutputTokens:number;totalTokens:number;cacheWriteInputTokens?:number};
export type ResearchAnswer={summary:string;findings:ResearchFinding[];missingEvidence:string[];model:string;createdAt:string;usage?:ResearchUsage;calculations?:ResearchCalculation[]};
export type ResearchQuestion={id:string;ticker:string;question:string;filters:ResearchFilters;status:string;answer:ResearchAnswer|null;context:ResearchPassage[];error:string|null;created_at:string;updated_at:string;cached?:boolean;workflow?:ResearchWorkflow|null};
export const seedResearchCompanies=[
  {ticker:"RELIANCE",name:"Reliance Industries",isin:"INE002A01018",sources:["https://www.ril.com/investors/financial-reporting","https://www.ril.com/investors/events-presentations"]},
  {ticker:"TCS",name:"Tata Consultancy Services",isin:"INE467B01029",sources:["https://www.tcs.com/investor-relations"]},
  {ticker:"INFY",name:"Infosys",isin:"INE009A01021",sources:["https://www.infosys.com/investors/reports-filings/annual-report/","https://www.infosys.com/investors/reports-filings/quarterly-results/"]},
  {ticker:"HINDUNILVR",name:"Hindustan Unilever",isin:"INE030A01027",sources:["https://www.hul.co.in/investors/"]},
  {ticker:"LT",name:"Larsen & Toubro",isin:"INE018A01030",sources:["https://investors.larsentoubro.com/financials-annual-reports.aspx","https://investors.larsentoubro.com/Transcripts-Archives.aspx"]},
  {ticker:"NTPC",name:"NTPC",isin:"INE733E01010",sources:["https://ntpc.co.in/investors/annual-reports","https://ntpc.co.in/investor-updates/transcripts"]},
];

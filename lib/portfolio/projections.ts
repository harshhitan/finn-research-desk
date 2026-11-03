// These are fixed SQL projections over the portfolio_analysis alias `a`.
// Briefing/queue scans never load every metric quote or source context into a
// Worker isolate. Full verified evidence is fetched for one filing on demand.
const metadata=['schemaVersion','promptVersion','evidenceRevision','model','inputFingerprint','sourceKind','category','resultPeriod'];
const fields=(keys:string[])=>keys.map(key=>`'${key}',json_extract(a.data,'$.${key}')`).join(',');
const figures="(json_extract(a.data,'$.resultPeriod.durationMonths')=3 AND EXISTS(SELECT 1 FROM json_each(a.data,'$.metrics') mi WHERE json_extract(mi.value,'$.context.durationMonths')=3 AND json_extract(mi.value,'$.context.periodEnd')=json_extract(a.data,'$.resultPeriod.periodEnd')))";
export const analysisMetadataSql=`json_object(${fields(metadata)},'hasVerifiedFigures',${figures})`;
export const analysisBriefSql=`json_object(${fields([...metadata,'priority','summary','whyItMatters','createdAt','status','contentHash','executiveBackground','evidenceGaps'])},'brief',json('true'),'metrics',json('[]'),'claims',json('[]'),'metricCount',COALESCE(json_array_length(a.data,'$.metrics'),0),'hasVerifiedFigures',${figures})`;

import type {ReportSummary} from './report-types';
// The server rounds these coordinates to a 0.01 degree grid (about 1 km).
export function reportPosition(report:Pick<ReportSummary,'map_latitude'|'map_longitude'>):[number,number]|null {
 const lat=report.map_latitude,lon=report.map_longitude;
 return typeof lat==='number'&&typeof lon==='number'&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180?[lat,lon]:null;
}
export function groupReportLocations(reports:ReportSummary[]) {
 const located=reports.flatMap(report=>{const position=reportPosition(report);return position?[{position,reports:[report]}]:[]});
 const cells=new Map<string,typeof located>();
 for(const item of located){const key=item.position.join(',');const cell=cells.get(key)||[];cell.push(item);cells.set(key,cell)}
 for(const cell of cells.values()){cell.sort((a,b)=>a.reports[0].id.localeCompare(b.reports[0].id));if(cell.length>1)cell.forEach((item,i)=>{const angle=2*Math.PI*i/cell.length;item.position=[item.position[0]+Math.sin(angle)*0.0015,item.position[1]+Math.cos(angle)*0.0015]})}
 return located;
}

import {ReportDetailView} from '@/components/report-detail';
export const dynamic='force-dynamic';
export default async function ReportPage({params}:{params:Promise<{id:string}>}){const {id}=await params;return <ReportDetailView id={id}/>}

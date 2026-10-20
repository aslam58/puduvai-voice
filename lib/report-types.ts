import type {Category,IssueStatus,Engagement} from './domain';
export type ReportSummary={map_latitude?:number|null;map_longitude?:number|null;id:string;category:Category;language:string;area:string;constituency?:number|null;title:string;status:IssueStatus;outage_started_at:string|null;outage_ended_at:string|null;created_at:string;supporters:number};
export type PrivateLocation={address:string|null;landmark:string|null;pin_code:string|null;latitude:number|null;longitude:number|null};
export type ReportDetail=ReportSummary & {private_location?:PrivateLocation|null;description:string|null;engagement:Engagement;owner:boolean;published:boolean;supported:boolean;following:boolean;photo_count:number;events:{kind:string;source:string;created_at:string}[]};

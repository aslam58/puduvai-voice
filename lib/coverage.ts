// Constituency numbers/names: CEO Puducherry electoral statistics, checked 17 October 2026.
// https://ceopuducherry.py.gov.in/ac_wise_electrol.php
export const regions=['Puducherry','Karaikal','Mahe','Yanam'] as const;
export type Region=typeof regions[number];
export const constituencies = [
 {id:1,name:'Mannadipet',region:'Puducherry'},
 {id:2,name:'Thirubhuvanai',region:'Puducherry'},
 {id:3,name:'Oussudu',region:'Puducherry'},
 {id:4,name:'Mangalam',region:'Puducherry'},
 {id:5,name:'Villianur',region:'Puducherry'},
 {id:6,name:'Ozhukarai',region:'Puducherry'},
 {id:7,name:'Kadirgamam',region:'Puducherry'},
 {id:8,name:'Indira Nagar',region:'Puducherry'},
 {id:9,name:'Thattanchavady',region:'Puducherry'},
 {id:10,name:'Kamaraj Nagar',region:'Puducherry'},
 {id:11,name:'Lawspet',region:'Puducherry'},
 {id:12,name:'Kalapet',region:'Puducherry'},
 {id:13,name:'Muthialpet',region:'Puducherry'},
 {id:14,name:'Raj Bhavan',region:'Puducherry'},
 {id:15,name:'Oupalam',region:'Puducherry'},
 {id:16,name:'Orleampeth',region:'Puducherry'},
 {id:17,name:'Nellithope',region:'Puducherry'},
 {id:18,name:'Mudaliarpet',region:'Puducherry'},
 {id:19,name:'Ariankuppam',region:'Puducherry'},
 {id:20,name:'Manavely',region:'Puducherry'},
 {id:21,name:'Embalam',region:'Puducherry'},
 {id:22,name:'Nettapakkam',region:'Puducherry'},
 {id:23,name:'Bahour',region:'Puducherry'},
 {id:24,name:'Nedungadu',region:'Karaikal'},
 {id:25,name:'Thirunallar',region:'Karaikal'},
 {id:26,name:'Karaikal North',region:'Karaikal'},
 {id:27,name:'Karaikal South',region:'Karaikal'},
 {id:28,name:'Neravy-T.R.Pattinam',region:'Karaikal'},
 {id:29,name:'Mahe',region:'Mahe'},
 {id:30,name:'Yanam',region:'Yanam'},
 ] as const;
// Approximate regional screening rectangles, not official constituency boundaries.
export const regionBounds:Record<Region,readonly [number,number,number,number]>={
 Puducherry:[11.70,12.10,79.50,79.90],Karaikal:[10.75,11.15,79.65,79.90],
 Mahe:[11.65,11.80,75.45,75.65],Yanam:[16.65,16.80,82.15,82.35]
};
export function inRegion(region:Region,latitude:number,longitude:number){
 const [south,north,west,east]=regionBounds[region];
 return Number.isFinite(latitude)&&Number.isFinite(longitude)&&latitude>=south&&latitude<=north&&longitude>=west&&longitude<=east;
}
export function constituencyName(id:number|null|undefined){return constituencies.find(c=>c.id===id)?.name;}

import type {Metadata} from 'next';
import './globals.css';
import {VisitorAnalytics} from '@/components/visitor-analytics';
export const metadata:Metadata={title:'Puduvai Voice · Puducherry',description:'An independent multilingual civic reporting pilot for Puducherry.',icons:{icon:[{url:'/favicon.svg',type:'image/svg+xml'},{url:'/brand/favicon-32.png',sizes:'32x32',type:'image/png'}],apple:[{url:'/brand/apple-touch-icon.png',sizes:'180x180',type:'image/png'}]}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}<VisitorAnalytics/></body></html>}

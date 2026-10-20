import {LoginForm} from '@/components/login-form';
import {googleAvailable} from '@/lib/auth/server';
export const dynamic = 'force-dynamic';
export const metadata = {title: 'Sign in · Puduvai Voice'};
export default async function LoginPage() {return <LoginForm googleEnabled={await googleAvailable()}/>;}

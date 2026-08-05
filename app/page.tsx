import { redirect } from 'next/navigation';

// Landing → search (global card search). /g/[game] is one click away.
export default function Home() {
  redirect('/search');
}

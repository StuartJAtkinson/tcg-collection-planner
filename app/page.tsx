import { redirect } from 'next/navigation';

// Collections landing → the first game's tabbed master-sets view. Games are tabs under
// Collections (rendered on /g/[game]), not separate top-nav entries.
export default function Home() {
  redirect('/g/mtg');
}

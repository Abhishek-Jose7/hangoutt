'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Users, History, User, Settings } from 'lucide-react';
import { ExpandableTabs } from '@/components/ui/expandable-tabs';

export default function BottomNavigation() {
  const pathname = usePathname();
  const router = useRouter();

  const navigation = [
    { title: 'Lobbies', icon: Users, href: '/groups' },
    { title: 'History', icon: History, href: '/history' },
    { title: 'Profile', icon: User, href: '/profile' },
    { title: 'Settings', icon: Settings, href: '/settings' },
  ];

  // Determine selected index based on current path
  const selectedIndex = navigation.findIndex((item) => {
    if (item.href === '/groups') {
      return pathname === '/groups' || pathname.startsWith('/groups/');
    }
    return pathname === item.href || pathname.startsWith(item.href + '/');
  });

  const handleSelect = (index: number | null) => {
    if (index !== null) {
      router.push(navigation[index].href);
    }
  };

  return (
    <nav className="fixed bottom-4 left-4 right-4 z-40 md:hidden flex justify-center safe-bottom">
      <ExpandableTabs
        tabs={navigation}
        activeColor="text-[#DC143C]"
        selectedIndex={selectedIndex !== -1 ? selectedIndex : null}
        onChange={handleSelect}
        className="w-full justify-around bg-black/80 border border-stone-850/80 backdrop-blur-md px-2 py-1.5 shadow-xl rounded-2xl"
      />
    </nav>
  );
}


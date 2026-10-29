import type { ReactNode, SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...rest }: P & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const IconHome = (p: P) => <Svg {...p}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-6h4v6" /></Svg>;
export const IconTitle = (p: P) => <Svg {...p}><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4" /><path d="M9 12h7M9 16h5" /></Svg>;
export const IconChat = (p: P) => <Svg {...p}><path d="M4 5h16v11H9l-5 4z" /><path d="M8 9.5h8M8 12.5h5" /></Svg>;
export const IconFlag = (p: P) => <Svg {...p}><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></Svg>;
export const IconBook = (p: P) => <Svg {...p}><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M4 19V5" /><path d="M8 7h7" /></Svg>;
export const IconBell = (p: P) => <Svg {...p}><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></Svg>;
export const IconUsers = (p: P) => <Svg {...p}><circle cx="9" cy="8" r="3.2" /><path d="M3 20c.6-3.3 3-5 6-5s5.4 1.7 6 5" /><path d="M16 4.6a3 3 0 0 1 0 6.2M18 15c1.8.6 3 2.3 3.4 5" /></Svg>;
export const IconUserCheck = (p: P) => <Svg {...p}><circle cx="9" cy="8" r="3.2" /><path d="M3 20c.6-3.3 3-5 6-5s5.4 1.7 6 5" /><path d="m15.5 11 2 2 4-4" /></Svg>;
export const IconChart = (p: P) => <Svg {...p}><path d="M4 20V4" /><path d="M4 20h16" /><path d="M8 16v-4M12 16V8M16 16v-6" /></Svg>;
export const IconSettings = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Svg>;
export const IconLog = (p: P) => <Svg {...p}><path d="M5 4h14v16H5z" /><path d="M9 8h6M9 12h6M9 16h3" /></Svg>;
export const IconDatabase = (p: P) => <Svg {...p}><ellipse cx="12" cy="5.5" rx="7" ry="2.5" /><path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13" /><path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" /></Svg>;
export const IconMenu = (p: P) => <Svg {...p}><path d="M4 6h16M4 12h16M4 18h16" /></Svg>;
export const IconLogout = (p: P) => <Svg {...p}><path d="M10 4H5v16h5" /><path d="m15 8 4 4-4 4" /><path d="M19 12H9" /></Svg>;
export const IconUpload = (p: P) => <Svg {...p}><path d="M12 15V4" /><path d="m7.5 8.5 4.5-4.5 4.5 4.5" /><path d="M5 15v5h14v-5" /></Svg>;
export const IconFile = (p: P) => <Svg {...p}><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4" /></Svg>;
export const IconSearch = (p: P) => <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></Svg>;
export const IconBookmark = (p: P) => <Svg {...p}><path d="M6 3h12v18l-6-4.5L6 21z" /></Svg>;
export const IconBookmarkFill = (p: P) => <Svg {...p} fill="currentColor"><path d="M6 3h12v18l-6-4.5L6 21z" /></Svg>;
export const IconCheck = (p: P) => <Svg {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg>;
export const IconArrowLeft = (p: P) => <Svg {...p}><path d="M19 12H5" /><path d="m11 18-6-6 6-6" /></Svg>;
export const IconPlus = (p: P) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const IconCalendar = (p: P) => <Svg {...p}><rect x="3.5" y="5" width="17" height="15" rx="1.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></Svg>;
export const IconUserCircle = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="10" r="3" /><path d="M6.5 18.5c1.2-2 3-3 5.5-3s4.3 1 5.5 3" /></Svg>;

export function BrandMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M9.5 11h6M9.5 15h4" />
    </svg>
  );
}
export const IconStar = (p: P) => <Svg {...p}><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" /></Svg>;
export const IconStarFill = (p: P) => <Svg {...p} fill="currentColor"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" /></Svg>;
export const IconChevronRight = (p: P) => <Svg {...p}><path d="m9 6 6 6-6 6" /></Svg>;
export const IconChevronDown = (p: P) => <Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>;
export const IconUpDown = (p: P) => <Svg {...p}><path d="m8 9 4-4 4 4" /><path d="m8 15 4 4 4-4" /></Svg>;
export const IconSidebar = (p: P) => <Svg {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M9.5 4.5v15" /></Svg>;
export const IconClock = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Svg>;
export const IconUndo = (p: P) => <Svg {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></Svg>;
export const IconHelp = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6" /><path d="M12 17h.01" /></Svg>;
export const IconOverview = (p: P) => <Svg {...p}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 13h8M8 17h5" /></Svg>;
export const IconHistory = (p: P) => <Svg {...p}><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" /><path d="M3.5 4v4h4" /><path d="M12 8v4l3 2" /></Svg>;
export const IconMoon = (p: P) => <Svg {...p}><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></Svg>;
export const IconSun = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></Svg>;
export const IconExam = (p: P) => <Svg {...p}><rect x="5" y="4.5" width="14" height="16.5" rx="1.5" /><path d="M9 3h6v3H9z" /><path d="m8.5 13 2 2 4-4.5" /></Svg>;
export const IconRedo = (p: P) => <Svg {...p}><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></Svg>;
export const IconAlignLeft = (p: P) => <Svg {...p}><path d="M4 6h16M4 10h10M4 14h16M4 18h10" /></Svg>;
export const IconAlignCenter = (p: P) => <Svg {...p}><path d="M4 6h16M7 10h10M4 14h16M7 18h10" /></Svg>;
export const IconAlignRight = (p: P) => <Svg {...p}><path d="M4 6h16M10 10h10M4 14h16M10 18h10" /></Svg>;
export const IconAlignJustify = (p: P) => <Svg {...p}><path d="M4 6h16M4 10h16M4 14h16M4 18h16" /></Svg>;
export const IconListBullet = (p: P) => <Svg {...p}><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></Svg>;
export const IconListNumber = (p: P) => <Svg {...p}><path d="M10 6h10M10 12h10M10 18h10" /><path d="M4 4.5h1.5V9M4 9h3M4 14.5c.5-.7 2.8-.9 2.8.6 0 1.1-2.8 2.1-2.8 3.4h3" /></Svg>;
export const IconIndent = (p: P) => <Svg {...p}><path d="M4 5h16M10 10h10M10 14h10M4 19h16" /><path d="m4 9.5 3 2.5-3 2.5" /></Svg>;
export const IconOutdent = (p: P) => <Svg {...p}><path d="M4 5h16M10 10h10M10 14h10M4 19h16" /><path d="m7 9.5-3 2.5 3 2.5" /></Svg>;
export const IconTable = (p: P) => <Svg {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="1.5" /><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10M15 9.5v10" /></Svg>;
export const IconImage = (p: P) => <Svg {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="1.5" /><circle cx="9" cy="10" r="1.6" /><path d="m4 18 5.5-5 4 3.5 2.5-2 4 3.5" /></Svg>;
export const IconPageBreak = (p: P) => <Svg {...p}><path d="M6 3v5h12V3M6 21v-5h12v5" /><path d="M3 12h3M9 12h2M13 12h2M18 12h3" /></Svg>;
export const IconDownload = (p: P) => <Svg {...p}><path d="M12 4v11" /><path d="m7.5 10.5 4.5 4.5 4.5-4.5" /><path d="M5 19h14" /></Svg>;
export const IconPrinter = (p: P) => <Svg {...p}><path d="M7 8V3.5h10V8" /><rect x="3.5" y="8" width="17" height="8" rx="1.5" /><path d="M7 13.5h10V21H7z" /></Svg>;
export const IconQuote = (p: P) => <Svg {...p}><path d="M5 7h14M9 11h10M9 15h10M5 19h14" /><path d="M5 11v4" /></Svg>;
export const IconManuscript = (p: P) => <Svg {...p}><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4" /><path d="m9 16.5 5.5-5.5 1.5 1.5-5.5 5.5H9z" /></Svg>;
export const IconMore = (p: P) => <Svg {...p}><circle cx="6" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="18" cy="12" r="1.3" fill="currentColor" /></Svg>;
export const IconExpand = (p: P) => <Svg {...p}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></Svg>;
export const IconShrink = (p: P) => <Svg {...p}><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></Svg>;
export const IconChip = (p: P) => <Svg {...p}><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M10 10h4v4h-4zM9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" /></Svg>;
export const IconOutline = (p: P) => <Svg {...p}><path d="M4 6h3M4 12h3M4 18h3M10 6h10M12 12h8M12 18h8" /></Svg>;
export const IconPage = (p: P) => <Svg {...p}><rect x="6" y="3.5" width="12" height="17" rx="1.5" /><path d="M9 8h6M9 11.5h6M9 15h4" /></Svg>;
export const IconWide = (p: P) => <Svg {...p}><rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="M7 9h10M7 12h10M7 15h7" /></Svg>;
export const IconClose = (p: P) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>;
export const IconEye = (p: P) => <Svg {...p}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></Svg>;
export const IconEyeOff = (p: P) => <Svg {...p}><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2" /><path d="M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /><path d="m3 3 18 18" /></Svg>;
export const IconAward = (p: P) => <Svg {...p}><circle cx="12" cy="9" r="5.5" /><path d="m9 13.8-1.5 7.2 4.5-2.5 4.5 2.5-1.5-7.2" /><path d="m10 9 1.4 1.4L14.2 7.6" /></Svg>;
export const IconRefresh = (p: P) => <Svg {...p}><path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" /><path d="M4 3v5h5" /><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16" /><path d="M20 21v-5h-5" /></Svg>;

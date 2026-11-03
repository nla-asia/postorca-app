import {
  CalendarDays,
  Clock3,
  Inbox,
  Newspaper,
  Target,
} from "lucide-react";
export const navigation = [
  {
    name: "Inbox",
    icon: Inbox,
  },
  {
    name: "Calendar",
    icon: CalendarDays,
  },
  {
    name: "Posts",
    icon: Newspaper,
  },
  {
    name: "Routines",
    icon: Clock3,
  },
  {
    name: "Brand",
    icon: Target,
  },
] as const;
export type NavigationItem = (typeof navigation)[number];
export type Page = NavigationItem["name"] | "Project";

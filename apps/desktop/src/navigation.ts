import {
  CalendarDays,
  Clock3,
  Inbox,
  MessageSquare,
  Target,
} from "lucide-react";
export const navigation = [
  {
    name: "Agent",
    icon: MessageSquare,
  },
  {
    name: "Inbox",
    icon: Inbox,
  },
  {
    name: "Calendar",
    icon: CalendarDays,
  },
  {
    name: "Routines",
    icon: Clock3,
  },
  {
    name: "Brand Profile",
    icon: Target,
  },
] as const;
export type NavigationItem = (typeof navigation)[number];
export type Page = NavigationItem["name"];

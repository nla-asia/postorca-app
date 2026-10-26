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
    description: "A place to work on your brand together.",
  },
  {
    name: "Inbox",
    icon: Inbox,
    description: "A place for your agent’s work and your feedback.",
  },
  {
    name: "Calendar",
    icon: CalendarDays,
    description: "A place to see what’s ahead.",
  },
  {
    name: "Routines",
    icon: Clock3,
    description: "A place for your brand’s ongoing work.",
  },
  {
    name: "Brand Profile",
    icon: Target,
    description: "A place for your brand’s direction, audience, and voice.",
  },
] as const;
export type NavigationItem = (typeof navigation)[number];
export type Page = NavigationItem["name"];

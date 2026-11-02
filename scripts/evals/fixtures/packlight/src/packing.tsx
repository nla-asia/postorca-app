import { createContext, useContext, useState, type ReactNode } from "react";

export type Item = {
  id: string;
  name: string;
  category: string;
  packed: boolean;
};
export const trips = [
  {
    id: "weekend",
    name: "A weekend away",
    place: "Chiang Mai",
    dates: "Fri – Sun · 3 days",
    color: "#DAE9DC",
    icon: "↗",
  },
  {
    id: "coast",
    name: "A little sea air",
    place: "The coast",
    dates: "Next week · 4 days",
    color: "#E0EBEF",
    icon: "≈",
  },
];
const seed = (): Record<string, Item[]> => ({
  weekend: [
    { id: "shirt", name: "Linen shirt", category: "Clothes", packed: true },
    {
      id: "trousers",
      name: "Comfortable trousers",
      category: "Clothes",
      packed: false,
    },
    { id: "jacket", name: "Light jacket", category: "Clothes", packed: false },
    {
      id: "charger",
      name: "Phone charger",
      category: "Essentials",
      packed: false,
    },
    {
      id: "book",
      name: "Something to read",
      category: "Essentials",
      packed: true,
    },
    {
      id: "toothbrush",
      name: "Toothbrush",
      category: "Essentials",
      packed: false,
    },
  ],
  coast: [
    { id: "swim", name: "Swimwear", category: "Clothes", packed: false },
    { id: "hat", name: "Sun hat", category: "Clothes", packed: false },
    {
      id: "sunscreen",
      name: "Sunscreen",
      category: "Essentials",
      packed: false,
    },
  ],
});
const Context = createContext<{
  lists: Record<string, Item[]>;
  toggle: (trip: string, item: string) => void;
  add: (trip: string, name: string) => void;
  reset: () => void;
} | null>(null);
export function PackingProvider({ children }: { children: ReactNode }) {
  const [lists, setLists] = useState(seed);
  return (
    <Context.Provider
      value={{
        lists,
        toggle: (trip, item) =>
          setLists((old) => ({
            ...old,
            [trip]: old[trip].map((i) =>
              i.id === item ? { ...i, packed: !i.packed } : i,
            ),
          })),
        add: (trip, name) => {
          const text = name.trim();
          if (text)
            setLists((old) => ({
              ...old,
              [trip]: [
                ...old[trip],
                {
                  id: `item-${Date.now()}`,
                  name: text,
                  category: "Extras",
                  packed: false,
                },
              ],
            }));
        },
        reset: () => setLists(seed()),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function usePacking() {
  const value = useContext(Context);
  if (!value) throw new Error("PackingProvider is required.");
  return value;
}

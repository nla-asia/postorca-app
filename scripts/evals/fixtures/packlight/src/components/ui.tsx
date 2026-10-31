import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewProps,
} from "react-native";
import type { ReactNode } from "react";
export const colors = {
  ink: "#24392D",
  muted: "#788378",
  paper: "#F7F8F2",
  line: "#DFE5D9",
  green: "#326C4B",
  soft: "#E8EEDF",
};
export function Button({
  title,
  onPress,
  secondary = false,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondary,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.buttonText, secondary && { color: colors.ink }]}>
        {title}
      </Text>
    </Pressable>
  );
}
export function Card({ children, style }: ViewProps & { children: ReactNode }) {
  return <View style={[styles.card, style]}>{children}</View>;
}
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  page: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    padding: 24,
    paddingBottom: 40,
    gap: 20,
  },
  eyebrow: {
    color: colors.green,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2.2,
    textTransform: "uppercase",
  },
  heading: {
    color: colors.ink,
    fontSize: 36,
    lineHeight: 40,
    fontWeight: "700",
    letterSpacing: -1.3,
  },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  label: { color: colors.ink, fontSize: 18, fontWeight: "600" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 22,
    borderWidth: 1,
    borderColor: colors.line,
    gap: 12,
  },
  button: {
    backgroundColor: colors.green,
    borderRadius: 14,
    minHeight: 48,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  secondary: { backgroundColor: colors.soft },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
});

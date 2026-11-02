import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { PackingProvider } from "../packing";
export default function Layout() {
  return (
    <PackingProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, animation: "none" }} />
    </PackingProvider>
  );
}

import { router } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { trips, usePacking } from "../packing";
import { Button, Card, colors, styles } from "../components/ui";
export default function Home() {
  const { lists, reset } = usePacking();
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={[styles.row, { marginBottom: 18 }]}>
          <Text style={styles.eyebrow}>Packlight ↗</Text>
          <Text style={styles.body}>A little less to carry.</Text>
        </View>
        <Text style={styles.heading}>
          Good trips start{`\n`}with a little list.
        </Text>
        <Text style={styles.body}>
          Keep the essentials in one place.{`\n`}Pack them, tick them, and go.
        </Text>
        <Text style={[styles.eyebrow, { marginTop: 18 }]}>
          Your next adventures
        </Text>
        {trips.map((trip) => {
          const packed = lists[trip.id].filter((item) => item.packed).length;
          return (
            <Pressable
              key={trip.id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${trip.name}`}
              onPress={() =>
                router.push({ pathname: "/trip", params: { id: trip.id } })
              }
            >
              <Card
                style={{ backgroundColor: trip.color, borderColor: trip.color }}
              >
                <View style={styles.row}>
                  <Text style={{ fontSize: 38, color: colors.green }}>
                    {trip.icon}
                  </Text>
                  <Text style={[styles.body, { color: colors.ink }]}>
                    {trip.dates}
                  </Text>
                </View>
                <Text style={[styles.label, { fontSize: 25 }]}>
                  {trip.name}
                </Text>
                <Text style={styles.body}>{trip.place}</Text>
                <View style={[styles.row, { marginTop: 16 }]}>
                  <Text style={{ color: colors.ink, fontSize: 14 }}>
                    {packed} of {lists[trip.id].length} packed
                  </Text>
                  <Text style={{ color: colors.ink, fontSize: 22 }}>→</Text>
                </View>
              </Card>
            </Pressable>
          );
        })}
        <Button title="Reset sample trips" onPress={reset} secondary />
        <Text style={[styles.body, { fontSize: 12, textAlign: "center" }]}>
          Your list, your pace. Changes last until the app reloads.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { trips, usePacking } from "../packing";
import { Button, Card, colors, styles } from "../components/ui";
export default function Trip() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trip = trips.find((t) => t.id === id) ?? trips[0];
  const { lists, toggle, add } = usePacking();
  const items = lists[trip.id];
  const packed = items.filter((item) => item.packed).length;
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState("");
  const listText = `${trip.name} — ${trip.place}\n${items.map((item) => `${item.packed ? "✓" : "○"} ${item.name}`).join("\n")}`;
  const addItem = () => {
    add(trip.id, draft);
    setDraft("");
  };
  const share = async () => {
    try {
      await Share.share({ message: listText });
    } catch {
      setError("The share sheet could not open. Please try again.");
    }
  };
  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.page}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to trips"
            onPress={() => router.replace("/")}
          >
            <Text
              style={{ color: colors.green, fontWeight: "600", fontSize: 15 }}
            >
              ← Your trips
            </Text>
          </Pressable>
          <Text style={styles.eyebrow}>
            {trip.place} · {trip.dates}
          </Text>
          <Text style={styles.heading}>{trip.name}</Text>
          <Card style={{ backgroundColor: colors.soft }}>
            <View style={styles.row}>
              <Text style={styles.label}>
                {packed === items.length
                  ? "You’re ready to go."
                  : "A little closer to ready."}
              </Text>
              <Text style={{ color: colors.green, fontWeight: "700" }}>
                {Math.round((packed / items.length) * 100)}%
              </Text>
            </View>
            <View
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: items.length, now: packed }}
              style={{
                height: 7,
                borderRadius: 4,
                backgroundColor: "#D4DFCA",
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  height: 7,
                  width: `${(packed / items.length) * 100}%`,
                  backgroundColor: colors.green,
                }}
              />
            </View>
            <Text style={styles.body}>
              {packed} of {items.length} packed · {items.length - packed} to go
            </Text>
          </Card>
          {[...new Set(items.map((item) => item.category))].map((category) => (
            <View key={category} style={{ gap: 2 }}>
              <Text style={[styles.eyebrow, { marginVertical: 12 }]}>
                {category}
              </Text>
              {items
                .filter((item) => item.category === category)
                .map((item) => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="checkbox"
                    accessibilityLabel={item.name}
                    accessibilityState={{ checked: item.packed }}
                    onPress={() => toggle(trip.id, item.id)}
                    style={[
                      styles.row,
                      {
                        minHeight: 52,
                        justifyContent: "flex-start",
                        borderBottomWidth: 1,
                        borderBottomColor: colors.line,
                      },
                    ]}
                  >
                    <View
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 8,
                        borderWidth: 1.5,
                        borderColor: item.packed ? colors.green : "#B8C3B2",
                        backgroundColor: item.packed ? colors.green : "#FFFFFF",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {item.packed && (
                        <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>
                          ✓
                        </Text>
                      )}
                    </View>
                    <Text
                      style={{
                        color: item.packed ? colors.muted : colors.ink,
                        fontSize: 16,
                        textDecorationLine: item.packed
                          ? "line-through"
                          : "none",
                      }}
                    >
                      {item.name}
                    </Text>
                  </Pressable>
                ))}
            </View>
          ))}
          <View style={[styles.row, { alignItems: "stretch", marginTop: 8 }]}>
            <TextInput
              accessibilityLabel="Add a packing item"
              placeholder="One more thing…"
              placeholderTextColor={colors.muted}
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={addItem}
              returnKeyType="done"
              maxLength={80}
              style={{
                flex: 1,
                minHeight: 48,
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: 14,
                paddingHorizontal: 14,
                backgroundColor: "#FFFFFF",
                color: colors.ink,
                fontSize: 15,
              }}
            />
            <Button title="Add" onPress={addItem} />
          </View>
          <Button
            title="Preview packing list"
            onPress={() => setPreview(true)}
            secondary
          />
          {Platform.OS !== "web" ? (
            <Button title="Share packing list" onPress={share} />
          ) : (
            <Text style={[styles.body, { fontSize: 12, textAlign: "center" }]}>
              Share your list with the iPhone app’s share sheet.
            </Text>
          )}
          {!!error && (
            <Text accessibilityRole="alert" style={styles.body}>
              {error}
            </Text>
          )}
        </ScrollView>
        <Modal
          visible={preview}
          transparent
          animationType="none"
          onRequestClose={() => setPreview(false)}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: "#24392D66",
              justifyContent: "center",
              padding: 24,
            }}
          >
            <Card style={{ maxWidth: 430, width: "100%", alignSelf: "center" }}>
              <Text style={styles.label}>Everything in one place.</Text>
              <Text
                style={[styles.body, { color: colors.ink, lineHeight: 28 }]}
              >
                {listText}
              </Text>
              <Button
                title="Back to packing"
                onPress={() => setPreview(false)}
              />
            </Card>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

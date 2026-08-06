import { useState } from 'react';
import { View, FlatList, Pressable, Modal, Alert, KeyboardAvoidingView, ScrollView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card } from '@/components/Card';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { CityPicker } from '@/components/CityPicker';
import { EmptyState } from '@/components/EmptyState';
import { useTheme } from '@/theme/ThemeContext';
import { useSavedAddressesStore } from '@/store/savedAddresses';

export default function SavedAddresses() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const addresses = useSavedAddressesStore((s) => s.addresses);
  const addAddress = useSavedAddressesStore((s) => s.add);
  const removeAddress = useSavedAddressesStore((s) => s.remove);

  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const startAdd = () => {
    setLabel('');
    setAddress('');
    setCity(undefined);
    setEditing(true);
  };

  const save = async () => {
    if (!label.trim() || !address.trim()) return;
    setSaving(true);
    await addAddress({ label: label.trim(), address: address.trim(), city });
    setSaving(false);
    setEditing(false);
  };

  const confirmRemove = (id: string, label: string) => {
    Alert.alert(`Remove "${label}"?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeAddress(id) },
    ]);
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm, flex: 1 }}>
          Saved Addresses
        </Text>
        <Pressable onPress={startAdd} hitSlop={8} accessibilityRole="button" accessibilityLabel="Add address">
          <Ionicons name="add-circle-outline" size={26} color={colors.primary} />
        </Pressable>
      </View>

      <FlatList
        data={addresses}
        keyExtractor={(a) => a.id}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        renderItem={({ item }) => (
          <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View
              style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary + '1A', alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="location" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1, marginLeft: spacing.sm }}>
              <Text variant="bodyMedium">{item.label}</Text>
              <Text variant="caption" color="secondary">
                {[item.address, item.city].filter(Boolean).join(', ')}
              </Text>
            </View>
            <Pressable onPress={() => confirmRemove(item.id, item.label)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${item.label}`}>
              <Ionicons name="close-circle-outline" size={20} color={colors.textMuted} />
            </Pressable>
          </Card>
        )}
        ListEmptyComponent={
          <EmptyState icon="location-outline" title="No saved addresses" message="Add a pickup or meetup address to reuse when chatting with buyers." actionLabel="Add address" onAction={startAdd} />
        }
      />

      <Modal visible={editing} animationType="slide" transparent onRequestClose={() => setEditing(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <Pressable style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }} onPress={() => setEditing(false)} accessibilityLabel="Close" accessibilityRole="button">
            <Pressable onPress={(e) => e.stopPropagation()}>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                style={{ maxHeight: '90%', backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg }}
                contentContainerStyle={{ padding: spacing.md }}
              >
                <Text variant="h3" style={{ marginBottom: spacing.md }}>
                  Add address
                </Text>
                <View style={{ gap: spacing.md }}>
                  <Input label="Label" placeholder="e.g. Home, Shop" value={label} onChangeText={setLabel} />
                  <Input label="Address" placeholder="Street, area, landmark" value={address} onChangeText={setAddress} />
                  <CityPicker value={city} onChange={setCity} />
                  <Button label="Save address" onPress={save} loading={saving} disabled={saving || !label.trim() || !address.trim()} fullWidth />
                </View>
              </ScrollView>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}

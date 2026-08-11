import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/ThemeContext';
import { OfflineBanner } from '@/components/OfflineBanner';
import { ChatUnreadBadge } from '@/components/ChatUnreadBadge';
import { requireAuth } from '@/store/authPrompt';
import { guardCall } from '@/lib/navGuard';
import { resetHomeBrowsing } from '@/store/homeBrowse';

// The Home tab's 'focus' event also fires once for the initial route when the
// tab navigator first mounts — that's Home being shown for the first time,
// not a "return" to it, so it must not reset. Skipping it also sidesteps a
// real race: useLocationStore's persisted city is still loading from
// AsyncStorage at that point (app/_layout.tsx), and resetting city here first
// would get silently overwritten once that async hydration resolves anyway.
let homeHasFocusedBefore = false;

export default function TabsLayout() {
  const { colors } = useTheme();
  const { t } = useTranslation();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <OfflineBanner />
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.tabBarBackground,
          borderTopColor: colors.border,
        },
      }}
    >
      <Tabs.Screen
      name="home"
      options={{
      title: t('nav.home'),
       tabBarIcon: ({ color, size }) => (
      <Ionicons name="home" color={color} size={size} />
    ),
  }}
  listeners={({ navigation }) => ({
    // Returning to Home from another tab (Search/Chats/Post/Profile) restores
    // its default browsing state (default tab, no category, all locations).
    // This only fires on an actual tab switch — a screen pushed on top of the
    // tabs (listing detail, notifications, settings...) and then popped back
    // does not re-trigger it, since the Home tab was never un-focused.
    focus: () => {
      if (!homeHasFocusedBefore) {
        homeHasFocusedBefore = true;
        return;
      }
      resetHomeBrowsing();
    },
    // Double-tapping the already-focused Home tab is a deliberate "start
    // over": reset the filters and pull the latest feed. (useScrollToTop
    // inside home.tsx handles the accompanying scroll-to-top for this same
    // tabPress event.)
    tabPress: () => {
      if (navigation.isFocused()) resetHomeBrowsing({ refetch: true });
    },
  })}
/>
      <Tabs.Screen
        name="search"
        options={{
          title: t('nav.search'),
          tabBarIcon: ({ color, size }) => <Ionicons name="search" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="post-tab"
        options={{
          title: t('nav.sell'),
          tabBarIcon: ({ color, size }) => <Ionicons name="add-circle" color={color} size={size + 4} />,
        }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            guardCall('tab:post', () => requireAuth(() => navigation.navigate('post' as never)));
          },
        })}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: t('nav.chats'),
          tabBarIcon: ({ color, size }) => (
            <View>
              <Ionicons name="chatbubbles" color={color} size={size} />
              <ChatUnreadBadge />
            </View>
          ),
        }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            guardCall('tab:chats', () => requireAuth(() => navigation.navigate('chats' as never)));
          },
        })}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('nav.profile'),
          tabBarIcon: ({ color, size }) => <Ionicons name="person" color={color} size={size} />,
        }}
      />
    </Tabs>
    </View>
  );
}

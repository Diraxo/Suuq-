import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/ThemeContext';
import { OfflineBanner } from '@/components/OfflineBanner';
import { ChatUnreadBadge } from '@/components/ChatUnreadBadge';
import { requireAuth } from '@/store/authPrompt';
import { guardCall } from '@/lib/navGuard';
import { homeRefresh } from '@/store/homeRefresh';

// A render error in this route shows a friendly retry screen instead of closing the app.
export { ErrorFallback as ErrorBoundary } from '@/components/ErrorFallback';

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
    // Tapping the already-focused Home tab resets Home to its default view
    // (category, place, price order, scroll position) and refetches the live
    // data; repeated taps share the in-flight request. Arriving at Home from
    // another tab does NOT reset — it shows Home as it was left. Pull-to-refresh
    // is the action that refetches while keeping the selections.
    tabPress: () => {
      homeRefresh.onHomeTabPress(navigation.isFocused());
    },
  })}
/>
      <Tabs.Screen
        name="search"
        options={{
          title: t('nav.search'),
          // Without this the tab bar rides up on top of the keyboard and eats the room the results need.
          tabBarHideOnKeyboard: true,
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

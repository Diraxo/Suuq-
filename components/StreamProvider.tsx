import React from 'react';
import { OverlayProvider, Chat } from 'stream-chat-expo';
import { streamClient } from '@/lib/stream';
import { useTheme } from '@/theme/ThemeContext';

/** Wraps the app in Stream Chat's client + overlay context (message actions, image viewer, attachment picker). Must sit above the navigation stack. */
export function StreamProvider({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();

  return (
    <OverlayProvider
      value={{
        style: {
          messageComposer: {
            container: { backgroundColor: colors.surface, borderTopColor: colors.border },
          },
          channelPreview: {
            container: { backgroundColor: colors.surface },
            title: { color: colors.textPrimary },
            date: { color: colors.textMuted },
            unreadContainer: { backgroundColor: colors.accent },
            message: { subtitle: { color: colors.textSecondary } },
          },
          typingIndicator: {
            text: { color: colors.textMuted },
          },
        },
      }}
    >
      <Chat client={streamClient}>{children}</Chat>
    </OverlayProvider>
  );
}

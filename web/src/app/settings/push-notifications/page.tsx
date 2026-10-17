'use client';

// Turns browser / home-screen push on or off for this device (lib/webPush.ts).
import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { PageHeader } from '@/components/PageHeader';
import { useRequireAuthPage } from '@/hooks/useRequireAuthPage';
import { enableWebPush, webPushState, WebPushState } from '@/lib/webPush';

const COPY: Record<WebPushState, string> = {
  on: 'Push notifications are on for this device.',
  off: 'Get a notification for new messages, offers and replies from support.',
  denied: 'Notifications are blocked for this site. Allow them in your browser or phone settings, then come back here.',
  unsupported: 'This browser does not support push notifications. On iPhone, add SUUQIYE to your Home Screen first.',
  unconfigured: 'Push notifications are not available yet on the web. Use the SUUQIYE app to receive them.',
};

export default function PushNotificationsPage() {
  const authed = useRequireAuthPage('/settings/push-notifications');
  const [state, setState] = useState<WebPushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void webPushState().then(setState);
  }, []);

  if (!authed) return <div className="min-h-[50vh]" />;

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      setState(await enableWebPush());
    } catch {
      setError('Could not turn notifications on. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <div className="mx-auto max-w-xl">
        <PageHeader title="Push Notifications" fallbackHref="/settings" />
        <Card>
          <p className="text-sm text-textPrimary">{state ? COPY[state] : 'Checking…'}</p>
          {state === 'off' && (
            <Button size="sm" className="mt-4" loading={busy} onClick={enable}>
              Turn on notifications
            </Button>
          )}
          {error && (
            <p className="mt-3 text-sm text-error" role="alert">
              {error}
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

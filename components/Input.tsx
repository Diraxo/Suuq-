import React, { useState } from 'react';
import { TextInput, View, TextInputProps, Platform, InputAccessoryView, Pressable, Keyboard } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from './Text';

type Props = TextInputProps & {
  label?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  /** Slightly bolder label weight for form sections that need extra readability — doesn't change size, just weight. */
  boldLabel?: boolean;
  /** Helper text shown under the field before any error — e.g. the allowed range for a numeric field. */
  hint?: string;
  /** Live "used / max" character counter shown under the field (turns to the error color once over the limit). */
  counter?: { current: number; max: number };
};

let accessoryIdCounter = 0;

export function Input({ label, error, hint, counter, leftIcon, rightIcon, boldLabel, style, multiline, keyboardType, returnKeyType, onSubmitEditing, onFocus, onBlur, ...rest }: Props) {
  const { t } = useTranslation();
  const { colors, radius, spacing, type } = useTheme();
  const [focused, setFocused] = useState(false);
  const [accessoryId] = useState(() => `input-done-bar-${accessoryIdCounter++}`);

  const isNumeric = keyboardType === 'numeric' || keyboardType === 'number-pad' || keyboardType === 'decimal-pad' || keyboardType === 'phone-pad';
  const showDoneBar = Platform.OS === 'ios' && isNumeric;

  return (
    <View style={{ width: '100%' }}>
      {label && (
        <Text variant="caption" color="secondary" style={{ marginBottom: spacing.xs, fontWeight: boldLabel ? '700' : undefined }}>
          {label}
        </Text>
      )}
      <View
        style={{
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
          backgroundColor: colors.inputBackground,
          borderRadius: radius.sm,
          borderWidth: 1.5,
          borderColor: error ? colors.error : focused ? colors.primary : 'transparent',
          paddingHorizontal: spacing.sm,
          paddingVertical: multiline ? spacing.xs : 0,
          minHeight: 50,
        }}
      >
        {leftIcon}
        <TextInput
          placeholderTextColor={colors.textMuted}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          multiline={multiline}
          keyboardType={keyboardType}
          returnKeyType={returnKeyType ?? (isNumeric && !multiline ? 'done' : undefined)}
          onSubmitEditing={onSubmitEditing ?? (isNumeric && !multiline ? () => Keyboard.dismiss() : undefined)}
          inputAccessoryViewID={showDoneBar ? accessoryId : undefined}
          accessibilityLabel={rest.accessibilityLabel ?? label}
          accessibilityHint={rest.accessibilityHint ?? (error ? undefined : hint)}
          style={[
            {
              flex: 1,
              color: colors.textPrimary,
              fontSize: type.body.size,
              marginLeft: leftIcon ? spacing.xs : 0,
              textAlignVertical: multiline ? 'top' : 'center',
            },
            style,
          ]}
          {...rest}
        />
        {rightIcon}
      </View>
      {error ? (
        <Text variant="caption" color="error" accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ marginTop: spacing.xxs }}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="tiny" color="muted" style={{ marginTop: spacing.xxs }}>
          {hint}
        </Text>
      ) : null}
      {counter && (
        <Text
          variant="tiny"
          color={counter.current > counter.max ? 'error' : 'muted'}
          align="right"
          style={{ marginTop: spacing.xxs }}
          accessibilityLabel={`${counter.current} of ${counter.max.toLocaleString('en-US')} characters`}
        >
          {counter.current.toLocaleString('en-US')} / {counter.max.toLocaleString('en-US')}
        </Text>
      )}
      {showDoneBar && (
        <InputAccessoryView nativeID={accessoryId}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'flex-end',
              padding: spacing.xs,
              backgroundColor: colors.surfaceElevated,
              borderTopWidth: 1,
              borderTopColor: colors.border,
            }}
          >
            <Pressable onPress={() => Keyboard.dismiss()} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('common.done')}>
              <Text variant="bodyMedium" color="brand">
                {t('common.done')}
              </Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      )}
    </View>
  );
}

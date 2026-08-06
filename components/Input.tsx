import React, { useState } from 'react';
import { TextInput, View, TextInputProps, Platform, InputAccessoryView, Pressable, Keyboard } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from './Text';

type Props = TextInputProps & {
  label?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  /** Slightly bolder label weight for form sections that need extra readability — doesn't change size, just weight. */
  boldLabel?: boolean;
};

let accessoryIdCounter = 0;

export function Input({ label, error, leftIcon, rightIcon, boldLabel, style, multiline, keyboardType, returnKeyType, onSubmitEditing, onFocus, onBlur, ...rest }: Props) {
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
      {error && (
        <Text variant="caption" color="error" style={{ marginTop: spacing.xxs }}>
          {error}
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
            <Pressable onPress={() => Keyboard.dismiss()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Done">
              <Text variant="bodyMedium" color="brand">
                Done
              </Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      )}
    </View>
  );
}

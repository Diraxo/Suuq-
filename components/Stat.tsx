import { View } from 'react-native';
import { Text } from './Text';

type Props = {
  label: string;
  value: string | number;
};

export function Stat({ label, value }: Props) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text variant="h3">{value}</Text>
      <Text variant="tiny" color="muted">
        {label}
      </Text>
    </View>
  );
}

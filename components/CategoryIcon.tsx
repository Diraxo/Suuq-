import { Ionicons, MaterialCommunityIcons, FontAwesome5 } from '@expo/vector-icons';
import { StyleProp, TextStyle } from 'react-native';

type Props = {
  icon: string;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
};

// Category/subcategory icons (data/categories.ts) are plain Ionicons glyph
// names by default, e.g. "car-outline". Ionicons is missing several literal
// glyphs this catalogue needs (rickshaw, motorbike, wardrobe, baby bottle...),
// so a name may instead be prefixed with another bundled icon family that
// already ships in @expo/vector-icons — "mci:rickshaw", "fa5:baby" — picked
// case by case wherever it reads as a clearly better match than an Ionicons
// approximation.
export function CategoryIcon({ icon, size = 20, color, style }: Props) {
  const sepIndex = icon.indexOf(':');
  const family = sepIndex === -1 ? 'ion' : icon.slice(0, sepIndex);
  const name = sepIndex === -1 ? icon : icon.slice(sepIndex + 1);

  if (family === 'mci') {
    return <MaterialCommunityIcons name={name as any} size={size} color={color} style={style} />;
  }
  if (family === 'fa5') {
    return <FontAwesome5 name={name as any} size={size} color={color} style={style} />;
  }
  return <Ionicons name={name as any} size={size} color={color} style={style} />;
}

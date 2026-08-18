import {
  Search, Heart, MapPin, ChevronRight, ChevronLeft, Share2, CheckCircle2,
  Star, X, XCircle, AlertCircle, Lock, Mail, FileText, Info, LogOut,
  User, Ban, Trash2, Bell, Languages, SlidersHorizontal, ShieldAlert,
  HelpCircle, Users, List, BarChart3, History, TrendingDown, Bookmark,
  Tag, ChevronUp, ChevronDown, Phone, MessageCircle, Flag, LineChart,
  ArrowLeftRight, PlusCircle, MessageSquare, Settings, PencilLine,
  Home, Building2, ShieldCheck, Camera as CameraIcon, Briefcase, Palette, Eye,
} from 'lucide-react';
import type { IconType } from 'react-icons';
import {
  IoBagHandleOutline, IoBarbellOutline, IoBasketOutline, IoBedOutline, IoBicycleOutline,
  IoBoatOutline, IoBonfireOutline, IoBookOutline, IoBriefcaseOutline, IoBuildOutline,
  IoBusOutline, IoBusinessOutline, IoCafeOutline, IoCameraOutline, IoCarOutline,
  IoCarSportOutline, IoCogOutline, IoColorPaletteOutline, IoConstructOutline, IoCubeOutline,
  IoCutOutline, IoDesktopOutline, IoDiamondOutline, IoEarthOutline, IoEggOutline,
  IoFastFoodOutline, IoFlashOutline, IoFootballOutline, IoFootstepsOutline, IoGameControllerOutline,
  IoHammerOutline, IoHappyOutline, IoHomeOutline, IoKeyOutline, IoLaptopOutline,
  IoLayersOutline, IoLeafOutline, IoLibraryOutline, IoMapOutline, IoMedkitOutline,
  IoMegaphoneOutline, IoNutritionOutline, IoPawOutline, IoPhonePortraitOutline, IoPrintOutline,
  IoRestaurantOutline, IoSchoolOutline, IoShieldCheckmarkOutline, IoShirtOutline, IoSparklesOutline,
  IoStorefrontOutline, IoSunnyOutline, IoTabletPortraitOutline, IoTvOutline, IoVolumeHighOutline,
  IoWalkOutline, IoWatchOutline, IoWaterOutline, IoWifiOutline,
  IoHelpCircleOutline,
} from 'react-icons/io5';
import { FaBaby } from 'react-icons/fa';
import {
  mdiAnvil, mdiBabyBottleOutline, mdiBabyCarriage, mdiBird, mdiCashRegister, mdiCow,
  mdiCupcake, mdiDesk, mdiFaceWomanOutline, mdiFish, mdiFlowerOutline, mdiFridgeOutline,
  mdiGeneratorStationary, mdiGreenhouse, mdiHairDryerOutline, mdiHandBackRightOutline,
  mdiHomeCityOutline, mdiHomeRoof, mdiMotorbike, mdiPipeWrench, mdiRickshaw,
  mdiSilverwareForkKnife, mdiSnowflake, mdiSofaOutline, mdiSprayBottle, mdiSprinklerVariant,
  mdiSwim, mdiTableChair, mdiTablePicnic, mdiTeddyBear, mdiToolboxOutline, mdiTractor,
  mdiTruckOutline, mdiWardrobeOutline, mdiWarehouse,
} from '@mdi/js';

// Category icons (data/categories.ts on mobile) are Ionicons5 / MaterialCommunityIcons /
// FontAwesome5 glyph identifiers. These are the SAME icon sets on web, not
// lookalikes: react-icons/io5 wraps the real Ionicons5 SVGs, react-icons/fa
// wraps the real FontAwesome5 Free SVGs, and MaterialCommunityIcons IS the
// Pictogrammers "Material Design Icons" set, whose path data ships as
// @mdi/js — rendered below through MdiIcon using the same 24x24 viewBox /
// single-path / currentColor convention the native glyph uses. Result: pixel-
// faithful silhouette, stroke weight and proportions vs. the mobile app, not
// an approximation.
const ION_MAP: Record<string, IconType> = {
  'bag-handle-outline': IoBagHandleOutline,
  'barbell-outline': IoBarbellOutline,
  'basket-outline': IoBasketOutline,
  'bed-outline': IoBedOutline,
  'bicycle-outline': IoBicycleOutline,
  'boat-outline': IoBoatOutline,
  'bonfire-outline': IoBonfireOutline,
  'book-outline': IoBookOutline,
  'briefcase-outline': IoBriefcaseOutline,
  'build-outline': IoBuildOutline,
  'bus-outline': IoBusOutline,
  'business-outline': IoBusinessOutline,
  'cafe-outline': IoCafeOutline,
  'camera-outline': IoCameraOutline,
  'car-outline': IoCarOutline,
  'car-sport-outline': IoCarSportOutline,
  'cog-outline': IoCogOutline,
  'color-palette-outline': IoColorPaletteOutline,
  'construct-outline': IoConstructOutline,
  'cube-outline': IoCubeOutline,
  'cut-outline': IoCutOutline,
  'desktop-outline': IoDesktopOutline,
  'diamond-outline': IoDiamondOutline,
  'earth-outline': IoEarthOutline,
  'egg-outline': IoEggOutline,
  'fast-food-outline': IoFastFoodOutline,
  'flash-outline': IoFlashOutline,
  'football-outline': IoFootballOutline,
  'footsteps-outline': IoFootstepsOutline,
  'game-controller-outline': IoGameControllerOutline,
  'hammer-outline': IoHammerOutline,
  'happy-outline': IoHappyOutline,
  'home-outline': IoHomeOutline,
  'key-outline': IoKeyOutline,
  'laptop-outline': IoLaptopOutline,
  'layers-outline': IoLayersOutline,
  'leaf-outline': IoLeafOutline,
  'library-outline': IoLibraryOutline,
  'map-outline': IoMapOutline,
  'medkit-outline': IoMedkitOutline,
  'megaphone-outline': IoMegaphoneOutline,
  'nutrition-outline': IoNutritionOutline,
  'paw-outline': IoPawOutline,
  'phone-portrait-outline': IoPhonePortraitOutline,
  'print-outline': IoPrintOutline,
  'restaurant-outline': IoRestaurantOutline,
  'school-outline': IoSchoolOutline,
  'shield-checkmark-outline': IoShieldCheckmarkOutline,
  'shirt-outline': IoShirtOutline,
  'sparkles-outline': IoSparklesOutline,
  'storefront-outline': IoStorefrontOutline,
  'sunny-outline': IoSunnyOutline,
  'tablet-portrait-outline': IoTabletPortraitOutline,
  'tv-outline': IoTvOutline,
  'volume-high-outline': IoVolumeHighOutline,
  'walk-outline': IoWalkOutline,
  'watch-outline': IoWatchOutline,
  'water-outline': IoWaterOutline,
  'wifi-outline': IoWifiOutline,
};

const FA_MAP: Record<string, IconType> = {
  'fa5:baby': FaBaby,
};

// MaterialCommunityIcons identifiers (`mci:` prefix) -> @mdi/js path data.
const MDI_MAP: Record<string, string> = {
  'mci:anvil': mdiAnvil,
  'mci:baby-bottle-outline': mdiBabyBottleOutline,
  'mci:baby-carriage': mdiBabyCarriage,
  'mci:bird': mdiBird,
  'mci:cash-register': mdiCashRegister,
  'mci:cow': mdiCow,
  'mci:cupcake': mdiCupcake,
  'mci:desk': mdiDesk,
  'mci:face-woman-outline': mdiFaceWomanOutline,
  'mci:fish': mdiFish,
  'mci:flower-outline': mdiFlowerOutline,
  'mci:fridge-outline': mdiFridgeOutline,
  'mci:generator-stationary': mdiGeneratorStationary,
  'mci:greenhouse': mdiGreenhouse,
  'mci:hair-dryer-outline': mdiHairDryerOutline,
  'mci:hand-back-right-outline': mdiHandBackRightOutline,
  'mci:home-city-outline': mdiHomeCityOutline,
  'mci:home-roof': mdiHomeRoof,
  'mci:motorbike': mdiMotorbike,
  'mci:pipe-wrench': mdiPipeWrench,
  'mci:rickshaw': mdiRickshaw,
  'mci:silverware-fork-knife': mdiSilverwareForkKnife,
  'mci:snowflake': mdiSnowflake,
  'mci:sofa-outline': mdiSofaOutline,
  'mci:spray-bottle': mdiSprayBottle,
  'mci:sprinkler-variant': mdiSprinklerVariant,
  'mci:swim': mdiSwim,
  'mci:table-chair': mdiTableChair,
  'mci:table-picnic': mdiTablePicnic,
  'mci:teddy-bear': mdiTeddyBear,
  'mci:toolbox-outline': mdiToolboxOutline,
  'mci:tractor': mdiTractor,
  'mci:truck-outline': mdiTruckOutline,
  'mci:wardrobe-outline': mdiWardrobeOutline,
  'mci:warehouse': mdiWarehouse,
};

function MdiIcon({ path, size, className }: { path: string; size: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="currentColor" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

export function CategoryIcon({ icon, size = 20, className }: { icon: string; size?: number; className?: string }) {
  const mdiPath = MDI_MAP[icon];
  if (mdiPath) return <MdiIcon path={mdiPath} size={size} className={className} />;

  // Fallback for any identifier not in the map (kept distinct from Tag below,
  // which is exported for unrelated generic UI use).
  const Icon = ION_MAP[icon] ?? FA_MAP[icon] ?? IoHelpCircleOutline;
  return <Icon size={size} className={className} />;
}

// Shared UI icon re-exports so the rest of the app imports icons from one
// place (mirrors mobile screens importing a single Ionicons name per use).
export {
  Search, Heart, MapPin, ChevronRight, ChevronLeft, Share2, CheckCircle2,
  Star, X, XCircle, AlertCircle, Lock, Mail, FileText, Info, LogOut,
  User, Ban, Trash2, Bell, Languages, SlidersHorizontal, ShieldAlert,
  HelpCircle, Users, List, BarChart3, History, TrendingDown, Bookmark,
  Tag, ChevronUp, ChevronDown, Phone, MessageCircle, Flag, LineChart,
  ArrowLeftRight, PlusCircle, MessageSquare, Settings, PencilLine,
  Home, Building2, ShieldCheck, CameraIcon, Briefcase, Palette, Eye,
};

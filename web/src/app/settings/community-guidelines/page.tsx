import { LegalPage } from '@/components/LegalPage';

// Copied verbatim from app/settings/community-guidelines.tsx on mobile.
const SECTIONS = [
  {
    title: 'Trade in good faith',
    body: "Describe items honestly, use real photos of what you're actually selling, and only list items you have the right to sell. Buyers should ask questions and inspect items before paying.",
  },
  {
    title: 'No illegal or dangerous items',
    body: 'Never list weapons, ammunition, explosives, drugs, or any item illegal to own or sell in your region.',
  },
  {
    title: 'No counterfeit or stolen goods',
    body: 'Listing counterfeit, replica, or stolen items is not allowed and may be reported to local authorities.',
  },
  {
    title: 'No adult content',
    body: 'Fursad is a family-friendly marketplace. Sexually explicit content, in listings, photos, or messages, is not allowed.',
  },
  {
    title: 'No scams',
    body: 'Never ask a buyer to pay before they inspect an item, and never send money to a seller you have not met or verified. Fursad never asks for payment through the app.',
  },
  {
    title: 'Be respectful',
    body: 'Harassment, hate speech, threats, and impersonating another person or business are not tolerated in listings, messages, or reviews.',
  },
  {
    title: 'What happens if you break these rules',
    body: 'Violating these guidelines can result in listing removal, warnings, or permanent account suspension, depending on severity. Use the Report button on any listing, user, or review to flag a violation.',
  },
];

export default function CommunityGuidelinesPage() {
  return <LegalPage title="Community Guidelines" sections={SECTIONS} />;
}

import { LegalPage } from '@/components/LegalPage';

// Copied verbatim from app/settings/terms.tsx on mobile.
const SECTIONS = [
  {
    title: '1. Using SUUQIYE',
    body: "SUUQIYE is a marketplace that connects buyers and sellers. You must be at least 18 years old, or have a parent or guardian's permission, to create an account. Accounts are created using Google Sign-In or Sign in with Apple. You are responsible for everything posted or sent from your account.",
  },
  {
    title: '2. Listings',
    body: 'Sellers must accurately describe items, own the right to sell them, and use real photos of the actual item for sale. SUUQIYE is not a party to any transaction between buyers and sellers — we do not handle payments, shipping, or escrow, and we are not responsible for the quality, safety, or legality of items listed.',
  },
  {
    title: '3. Prohibited items and conduct',
    body: 'You may not list stolen, counterfeit, illegal, or dangerous goods, or use SUUQIYE to harass, scam, mislead, or impersonate another person or business — see our Community Guidelines for details. Use the Report button on any listing, profile, or review to flag a violation. We may remove any listing, review, or account that violates these terms, our Community Guidelines, or local law, at our discretion.',
  },
  {
    title: '4. Meeting and paying safely',
    body: 'We strongly recommend meeting in a public place, inspecting an item before paying, and never sending money in advance to someone you have not met. SUUQIYE cannot reverse a payment made outside the app and is not liable for losses from in-person transactions.',
  },
  {
    title: '5. Your content',
    body: 'You keep ownership of the photos, text, and messages you post, but you grant SUUQIYE a license to host and display that content within the app so listings can be browsed, chats can be delivered, and reviews can be shown to other users. You are responsible for having the rights to anything you upload.',
  },
  {
    title: '6. Account suspension and deletion',
    body: 'We may suspend or terminate accounts that violate these terms, receive repeated credible reports, or engage in fraudulent activity. You can permanently delete your account at any time from Settings > Delete Account; see our Privacy Policy for what is removed.',
  },
  {
    title: '7. Third-party services',
    body: 'SUUQIYE relies on third-party services to operate, including Google (Sign-In and push notifications), Apple (Sign in with Apple and push notifications on iOS) and cloud hosting and storage providers. Your use of those underlying services may also be subject to their own terms.',
  },
  {
    title: '8. Intellectual property',
    body: 'The SUUQIYE name, logo, and app design are owned by SUUQIYE and may not be copied or used without permission. You keep ownership of your own content as described above.',
  },
  {
    title: '9. Disclaimer and limitation of liability',
    body: 'SUUQIYE is provided "as is." We do not guarantee the accuracy of listings, the conduct of users, or that the app will always be available or error-free. To the extent permitted by law, SUUQIYE is not liable for any indirect, incidental, or consequential damages arising from your use of the app.',
  },
  {
    title: '10. Changes to these terms',
    body: 'We may update these terms as SUUQIYE evolves. Continued use of the app after a change means you accept the updated terms.',
  },
  {
    title: '11. Contact',
    body: 'Questions about these terms can be sent to suuqiyesupport@gmail.com.',
  },
];

export default function TermsPage() {
  return <LegalPage title="Terms of Service" sections={SECTIONS} />;
}

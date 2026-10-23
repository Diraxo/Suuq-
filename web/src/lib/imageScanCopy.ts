// Wording of the photo-check dialog on web. These strings are COPIED from locales/en/translation.json (imageScan.*) so
// mobile and web tell sellers exactly the same thing; tests/imageParity.test.ts fails if they drift. Web has no i18n layer yet.
export const IMAGE_SCAN_COPY = {
  "checking": {
    "title": "Checking your listing",
    "subtitle": "This usually takes a few seconds. Your draft is safe.",
    "stagePhotos": "Photo quality",
    "stageDuplicates": "Watermarks and duplicates",
    "stageSafety": "Image safety",
    "stageCategory": "Category match",
    "a11y": "Checking your photos. Please wait."
  },
  "result": {
    "fixTitle": "A few photos need your attention",
    "reviewTitle": "Your listing needs a quick review",
    "reviewIntro": "Your listing will stay hidden until our team has looked at it. This usually doesn’t take long.",
    "fixIntro": "The photos you added are kept. Replace only the ones below.",
    "photoN": "Photo {{n}}",
    "photosLabel": "Photos: {{list}}",
    "replace": "Replace photos",
    "publishForReview": "Publish for review",
    "tryAgain": "Try again",
    "close": "Close"
  },
  "errors": {
    "offline": "You appear to be offline. Your draft is safe. Please try again.",
    "timeout": "Checking took too long. Your draft is safe. Please try again.",
    "rate_limited": "You have checked a lot of photos recently. Please try again in a little while.",
    "busy": "Your photos are already being checked. Please wait a moment and try again.",
    "unreadable": "One of the photos could not be read. Please replace it and try again.",
    "failed": "We couldn’t finish checking your photos. Your draft is safe. Please try again.",
    "update_required": "Please update Suuqiye to add photos. This version can no longer upload listing photos.",
    "not_verified": "One or more photos couldn’t be verified. Please check your photos again and try publishing.",
    "photo_rejected": "One of the photos can’t be used on Suuqiye. Please replace it and try again.",
    "policy_unavailable": "We couldn’t prepare your photo check right now. Your draft is safe. Please try again."
  },
  "issue": {
    "watermark_own": {
      "title": "Please upload the original photo",
      "message": "This photo appears to contain a watermark. Please choose a clean image without a watermark. Suuqiye will add its own watermark when your listing is published."
    },
    "watermark_other": {
      "title": "Please upload the original photo",
      "message": "This photo appears to contain a watermark. Please choose a clean image without a watermark. Suuqiye will add its own watermark when your listing is published."
    },
    "watermark_uncertain": {
      "title": "We couldn’t tell if this photo has a watermark",
      "message": "A reviewer will take a quick look. You can also replace it with a clean original photo."
    },
    "duplicate_listing": {
      "title": "This photo looks familiar",
      "message": "This photo looks similar to an image already on Suuqiye. Please use your own original photo, or continue and we will review it."
    },
    "duplicate_in_batch": {
      "title": "Same photo added twice",
      "message": "This photo was added more than once. Please remove the extra copy."
    },
    "prohibited_content": {
      "title": "This photo can’t be used",
      "message": "This photo can’t be used in a Suuqiye listing. Please choose an image that follows our content rules."
    },
    "weapon": {
      "title": "This photo can’t be used",
      "message": "This photo can’t be used in a Suuqiye listing. Please choose an image that follows our content rules."
    },
    "weapon_uncertain": {
      "title": "This photo needs a quick review",
      "message": "Some photos need a quick review before your listing goes live."
    },
    "content_uncertain": {
      "title": "This photo needs a quick review",
      "message": "Some photos need a quick review before your listing goes live."
    },
    "category_mismatch": {
      "title": "This photo may not match your category",
      "message": "You selected {{category}}, but this photo doesn’t appear to show a matching item. Please replace it or check your category."
    },
    "category_uncertain": {
      "title": "We couldn’t confidently identify this photo",
      "message": "A reviewer will take a quick look, or you can replace it with a clearer photo."
    },
    "check_failed": {
      "title": "We couldn’t finish checking your photos",
      "message": "We couldn’t finish checking your photos. Your draft is safe. Please try again."
    }
  }
} as const;

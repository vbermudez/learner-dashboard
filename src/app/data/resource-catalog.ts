import { LearningResource } from '../models/learning-resource.model';

export const RESOURCE_CATALOG: LearningResource[] = [
  {
    id: 'h5p-intro-course',
    title: 'H5P: Intro To Product Safety',
    kind: 'h5p',
    description:
      'Drop an exported .h5p package URL here. Use this card as a template for H5P activities learners can carry offline.',
    estimatedSize: '20-120 MB',
    packageUrl: 'https://1drv.ms/u/c/d7b96adfeee8b80c/IQDU19GEGnlTSrO4b1uOhkMSAZZFBEl2JTHl15YEGA9eK3o?e=Vtsph1&download=1',
    launchUrl: 'https://h5p.org/h5p/embed/612',
    tags: ['H5P', 'interactive', 'compliance'],
  },
  {
    id: 'tincan-sales-sim',
    title: 'TinCan/xAPI: Sales Simulation',
    kind: 'tincan',
    description:
      'Paste a TinCan package zip URL plus an optional launch URL from your LMS or LRS-compatible delivery endpoint.',
    estimatedSize: '50-200 MB',
    packageUrl: '',
    launchUrl: '',
    tags: ['xAPI', 'TinCan', 'simulation'],
  },
  {
    id: 'scorm-customer-care',
    title: 'SCORM + xAPI Bridge: Customer Care',
    kind: 'scorm',
    description:
      'Use for classic SCORM packages that are mirrored as downloadable zip bundles and tracked with xAPI.',
    estimatedSize: '30-180 MB',
    packageUrl: 'https://scorm.com/wp-content/assets/golf_examples/PIFS/ContentPackagingSingleSCO_SCORM20043rdEdition.zip',
    launchUrl: 'https://app.cloud.scorm.com/sc/InvitationConfirmEmail?publicInvitationId=968463ff-08fc-4028-9e2b-f93b05e0e7c4',
    tags: ['SCORM', 'legacy', 'xAPI bridge'],
  },
  {
    id: 'web-html-primer',
    title: 'HTML Primer (Web Lesson)',
    kind: 'web',
    description:
      'Real downloadable sample for testing progress and offline cache. Replace with your LMS-hosted lesson package.',
    estimatedSize: '1-5 MB',
    packageUrl: 'https://www.adobe.com/support/products/enterprise/knowledgecenter/media/c4611_sample_explain.pdf',
    launchUrl: 'https://www.adobe.com/support/products/enterprise/knowledgecenter/media/c4611_sample_explain.pdf',
    tags: ['sample', 'download-ready'],
  },
  {
    id: 'media-safety-brief',
    title: 'Safety Briefing Video',
    kind: 'media',
    description:
      'Real downloadable media sample to validate offline behavior and learner playback from cached content.',
    estimatedSize: '5-25 MB',
    packageUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
    launchUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
    tags: ['sample', 'video', 'offline-playback'],
  },
];

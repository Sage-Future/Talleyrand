import type { FC } from 'react';
import type { DeclineReason } from '../../types';
import { KnowThisIcon, TooBasicIcon, OffTopicIcon, UnclearIcon } from './declineReasonIcons';

// Chip labels + LessWrong-style reaction icons for declining a suggested
// question. `title` is the hover text; on the suggestion cards, where the icons
// stand alone without their labels, it is prefixed with "Decline — ".
export const DECLINE_REASONS: {
  reason: DeclineReason;
  label: string;
  title: string;
  Icon: FC<{ className?: string }>;
}[] = [
  {
    reason: 'know_this',
    label: 'know this',
    title: 'Already know this',
    Icon: KnowThisIcon,
  },
  {
    reason: 'too_basic',
    label: 'too basic',
    title: "Too Basic — doesn't matter",
    Icon: TooBasicIcon,
  },
  { reason: 'off_topic', label: 'off-topic', title: 'Off-Topic', Icon: OffTopicIcon },
  {
    reason: 'unclear',
    label: "don't get the question",
    title: "Don't get the question",
    Icon: UnclearIcon,
  },
];

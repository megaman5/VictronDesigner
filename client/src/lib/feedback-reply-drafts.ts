export interface ReplyDraft {
  subject: string;
  body: string;
}

// Tailored reply drafts for the initial batch of feedback, keyed by feedback id.
// Any feedback not listed here falls back to the generic template in
// buildReplyDraft(). Edit freely in the admin UI before sending.
export const FEEDBACK_REPLY_DRAFTS: Record<string, ReplyDraft> = {
  // [redacted-email] — "I cannot find or delete this component (a battery)"
  "2b8e7fe2-ef6f-459f-ab67-8bf6adc2dcc6": {
    subject: "Re: your VictronDesigner feedback — you can now delete components",
    body: `Hi,

Thanks for taking the time to send feedback. You were right — deleting was hard to find. We just added a clear "Delete Component" button: click any component on the canvas and you'll see it in the panel on the right. (The Delete or Backspace key works too.)

Give it a try and let me know if anything else gets in your way.

Thanks,
Sean
VictronDesigner.com`,
  },

  // [redacted-email] — missing Quattro/Argo FET/Cyrix-CT, custom components, 2x12V series
  "b3330191-36cd-4ba0-b7d6-d9da9b117c88": {
    subject: "Re: your VictronDesigner feedback from a location",
    body: `Hi a user,

Thanks for the detailed note — greetings to a location!

Two of your points are now done:

1. Series batteries (2x12V → 24V) are now first-class. Place two 12V batteries, set each to 12V, then wire battery 1 "positive" to battery 2 "negative" to make the series link. Set the system voltage to 24V and you're set. The battery panel now shows the combined bank — voltage, amp-hours, and total kWh — and the design checks understand the bank, so you won't get false "voltage mismatch" or "unfused cable" warnings on the series link. For 24V banks built from 12V blocks, the tool also suggests adding a Victron Battery Balancer.

2. The "Add Custom Component" button now works — it opens a dialog where you name the part and drop a generic, fully wireable component on the canvas.

Still on the to-do list, and I want to be honest about it:
- Dedicated Quattro / Argo FET / Cyrix-CT symbols. Until those land, you can add each one as a named custom component and wire it up like anything else.

I really appreciate the feedback — it's exactly the kind that shapes the tool. If you give the series wiring a try, I'd love to know how it works for your setup.

Thanks,
Sean
VictronDesigner.com`,
  },

  // [redacted-email] — crude, no delete, AI doesn't work
  "be9e5a98-16ed-4c4a-8c16-255dea990757": {
    subject: "Re: your VictronDesigner feedback — a few fixes from your notes",
    body: `Hi,

Thank you for the honest feedback, and for sharing what you're building — a canal boat with alternator + shore + solar across starter, leisure and bow thruster banks is a great real-world test.

A couple of the things you hit are now fixed:
- Deleting items: there's now a clear Delete button when you select a component or wire (Delete/Backspace also works).
- AI generation: the wire and system-prompt AI is working again — worth another try.

It's still early and rough in places, but feedback like yours is what pushes it forward. If you do map out the canal boat system, I'd love to hear how it goes.

Thanks,
Sean
VictronDesigner.com`,
  },

  // [redacted-email] — Orion DC-DC, balancer, Lynx, mm2
  "99117e50-0b91-4186-a08c-fef8882bd3db": {
    subject: "Re: your VictronDesigner feedback — most of your wishlist is in",
    body: `Hi a user,

Thanks for the kind words and the clear wishlist — most of it is now in:
- Orion-Tr Smart DC-DC (12/24 and 24/12) — added.
- Battery Balancer for 2x12V series banks — added.
- Wire gauge in mm² — supported; you can switch the export between AWG and mm².

On the Lynx items: as you suggested, those can be represented today with a busbar plus a fuse, so they're lower priority — but noted for a proper symbol later.

Thanks again for helping make the tool better.

Sean
VictronDesigner.com`,
  },

  // [redacted-email] — further development? where is file saved?
  "60108fa8-f468-44cc-ad96-760790c12061": {
    subject: "Re: your VictronDesigner questions",
    body: `Hi a user,

Thanks for trying the tool for your RV build!

To answer your questions:
- Yes, it's under active development — new components and fixes are landing regularly (recently: more Victron parts, mm² wire sizing, and easier editing).
- Where your file is saved: if you sign in with Google, use "Save Design" and your designs are stored to your account so you can reopen them anytime from "Open Design". If you're not signed in, the design lives only in your current browser session, so signing in and saving is the safe way to keep it.

Happy to help if you get stuck anywhere.

Thanks,
Sean
VictronDesigner.com`,
  },

  // [redacted-email] — wiring broken, panel lost, mm2
  "d8e598cf-2181-436d-8c82-4a94b79fe1e8": {
    subject: "Re: your VictronDesigner feedback — wiring + mm² improvements",
    body: `Hi,

Thanks for the feedback — and for the encouragement on the concept.

A few things have improved since you wrote:
- mm² wire sizes: you can now switch from AWG to mm² — fully supported.
- Wiring: the connection and routing system has had a lot of fixes for reliability and display.
- Component info panel: selecting a component reliably shows its details (and there's now a clear Delete button there too).

It's still evolving, so if you give it another go and something still feels off, I'd genuinely like to know.

Thanks,
Sean
VictronDesigner.com`,
  },
};

// Returns a tailored draft if one exists for this feedback, otherwise a
// friendly generic template that quotes the original message.
export function buildReplyDraft(feedback: { id: string; message: string }): ReplyDraft {
  const tailored = FEEDBACK_REPLY_DRAFTS[feedback.id];
  if (tailored) return tailored;

  const quoted = feedback.message.split("\n").map((line) => `> ${line}`).join("\n");
  return {
    subject: "Re: your VictronDesigner.com feedback",
    body: `Hi,

Thanks for taking the time to send feedback on VictronDesigner.com — it really helps.

You wrote:
${quoted}

[Write your reply here]

Thanks,
Sean
VictronDesigner.com`,
  };
}

// Builds a Gmail "compose" deep link that opens a prefilled message in the
// user's signed-in Gmail account (To / Subject / Body).
export function buildGmailComposeUrl(to: string, subject: string, body: string): string {
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to,
    su: subject,
    body,
  });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

export interface ReplyDraft {
  subject: string;
  body: string;
}

// Tailored reply drafts for the initial batch of feedback, keyed by feedback id.
// Recipient name/email are intentionally NOT stored here (this repo is public);
// the recipient address comes from the feedback record at send time and the
// greeting stays generic. Any feedback not listed falls back to the generic
// template in buildReplyDraft(). Edit freely in the admin UI before sending.
export const FEEDBACK_REPLY_DRAFTS: Record<string, ReplyDraft> = {
  // Could not find/delete a component
  "2b8e7fe2-ef6f-459f-ab67-8bf6adc2dcc6": {
    subject: "Re: your VictronDesigner feedback — you can now delete components",
    body: `Hi,

Thanks for taking the time to send feedback. You were right — deleting was hard to find. We just added a clear "Delete Component" button: click any component on the canvas and you'll see it in the panel on the right. (The Delete or Backspace key works too.)

Give it a try and let me know if anything else gets in your way.

Thanks,
Sean
VictronDesigner.com`,
  },

  // Missing modules (Quattro/Argo FET/Cyrix-CT), custom components, 2x12V series
  "b3330191-36cd-4ba0-b7d6-d9da9b117c88": {
    subject: "Re: your VictronDesigner feedback",
    body: `Hi,

Thanks for the detailed note!

Everything you asked for is now in:

1. Dedicated Quattro, Argo FET, and Cyrix-CT components — all three are in the Victron section of the component library, with proper terminals (the Quattro has both AC inputs).

2. Series batteries (2x12V → 24V) are now first-class. Place two 12V batteries, set each to 12V, then wire battery 1 "positive" to battery 2 "negative" to make the series link — the polarity check now recognizes battery series links instead of blocking them. Set the system voltage to 24V and you're set. The battery panel shows the combined bank, and for 24V banks built from 12V blocks the tool also suggests adding a Victron Battery Balancer.

3. The "Add Custom Component" button now works — it opens a dialog where you name the part and drop a generic, fully wireable component on the canvas, for anything that still doesn't have its own symbol.

I really appreciate the feedback — it's exactly the kind that shapes the tool. If you give the series wiring a try, I'd love to know how it works for your setup.

Thanks,
Sean
VictronDesigner.com`,
  },

  // Crude, no delete, AI not working
  "be9e5a98-16ed-4c4a-8c16-255dea990757": {
    subject: "Re: your VictronDesigner feedback — a few fixes from your notes",
    body: `Hi,

Thank you for the honest feedback, and for sharing what you're building — a canal boat with alternator + shore + solar across starter, leisure and bow thruster banks is a great real-world test.

A couple of the things you hit are now fixed:
- Deleting items: there's now a clear Delete button when you select a component or wire (Delete/Backspace also works).
- AI generation: the wire and system-prompt AI is working again — worth another try.

It's still early and rough in places, but feedback like yours is what pushes it forward. If you do map out the system, I'd love to hear how it goes.

Thanks,
Sean
VictronDesigner.com`,
  },

  // Orion DC-DC, balancer, Lynx, mm2 wishlist
  "99117e50-0b91-4186-a08c-fef8882bd3db": {
    subject: "Re: your VictronDesigner feedback — most of your wishlist is in",
    body: `Hi,

Thanks for the kind words and the clear wishlist — most of it is now in:
- Orion-Tr Smart DC-DC (12/24 and 24/12) — added.
- Battery Balancer for 2x12V series banks — added.
- Wire gauge in mm² — supported; you can switch the export between AWG and mm².

On the Lynx items: as you suggested, those can be represented today with a busbar plus a fuse, so they're lower priority — but noted for a proper symbol later.

Thanks again for helping make the tool better.

Sean
VictronDesigner.com`,
  },

  // NEC vs ABYC/SAE wire ampacity standards
  "b39637c9-04d5-45cc-9cd1-25e1acbda649": {
    subject: "Re: your VictronDesigner feedback — now using ABYC marine ampacity tables",
    body: `Hi,

Thanks — you were absolutely right, and this is fixed.

The ampacity tables were NEC Table 310.16 values (conductors in conduit, building wiring, capped at 90°C insulation). The calculator now uses the ABYC E-11 ratings for single conductors in free air, with a 105°C insulation column as the default — which matches typical UL 1426 marine cable. Temperature correction follows the ABYC approach too, so at a 50°C engine-space ambient you get the familiar ~0.85 factor for 105°C wire.

Voltage drop (3% per ABYC) still governs most low-voltage runs, so many recommendations won't change — but the ampacity limits are no longer overly conservative, and the numbers now come from the right standard.

Thanks for keeping us honest on this one.

Sean
VictronDesigner.com`,
  },

  // Further development? Where is file saved?
  "60108fa8-f468-44cc-ad96-760790c12061": {
    subject: "Re: your VictronDesigner questions",
    body: `Hi,

Thanks for trying the tool for your build!

To answer your questions:
- Yes, it's under active development — new components and fixes are landing regularly (recently: more Victron parts, mm² wire sizing, and easier editing).
- Where your file is saved: if you sign in with Google, use "Save Design" and your designs are stored to your account so you can reopen them anytime from "Open Design". If you're not signed in, the design lives only in your current browser session, so signing in and saving is the safe way to keep it.

Happy to help if you get stuck anywhere.

Thanks,
Sean
VictronDesigner.com`,
  },

  // Wiring broken, panel lost, mm2
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

  // 240V inverter option + health check falsely reporting shunt not connected
  "114f2486-c855-42eb-8c4b-df821fa6ff6b": {
    subject: "Re: your VictronDesigner feedback \u2014 both issues fixed",
    body: `Hi,

Thanks for the blunt feedback \u2014 both of the things you hit were real bugs, and both are fixed now.

1. The false "connect shunt negative to battery negative" error. You were right: the wires WERE connected. The health check was only looking for that wire drawn in one direction (battery \u2192 shunt). If you drew it shunt \u2192 battery, or ran it through a disconnect switch, or connected it to the second battery in a bank, it reported the connection as missing. It now checks the actual electrical path in both directions, so it should stop nagging you about wiring you have already done.

2. 240V. Every inverter (MultiPlus, Quattro, Phoenix, generic) now has an "AC Output Voltage" setting with three choices: 120V for North America, 230V for Europe/Australia, and 120/240V split phase for the North American split-phase models. AC loads can be set to 240V too, and the tool now warns you if a load's voltage does not match what the inverter can actually supply \u2014 for example a 240V well pump on a 120V-only unit. Shore power can be set to 240V as well.

Both are live now. If you run into anything else that reports a problem that is not really there, please tell me \u2014 that kind of report is the most useful thing I get.

Thanks,
Sean
VictronDesigner.com`,
  },

  // Lynx request
  "42f33770-2a4c-41a3-ba3b-0168e5f32bc6": {
    subject: "Re: your VictronDesigner feedback \u2014 Lynx modules are in",
    body: `Hi,

Thanks for the suggestion \u2014 the Lynx family is now in the component library, under the Victron section:

- Lynx Power In \u2014 the plain 1000A busbar pair, four unfused +/- connection pairs
- Lynx Distributor \u2014 busbar pair with four MEGA-fused outputs plus negative returns
- Lynx Shunt VE.Can \u2014 busbar pair with the built-in shunt and main fuse holder
- Lynx Smart BMS \u2014 BMS with the integrated contactor and shunt, for Victron lithium

They all carry the shared positive/negative busbars, so you can bolt them together the way the real modules stack: wire the OUT+ / OUT- of one module to the BUS+ / BUS- of the next. The Lynx Shunt and Smart BMS both count as the main battery fuse in the design checks, since they have one built in.

Give them a try and let me know if the terminals do not line up with how you actually wire them.

Thanks,
Sean
VictronDesigner.com`,
  },

  // MPPT load terminals
  "3fde2041-0ee4-4be9-b69a-ab00d1253b73": {
    subject: "Re: your VictronDesigner feedback \u2014 MPPT load terminals added",
    body: `Hi,

You were right \u2014 the smaller SmartSolar controllers have LOAD output terminals and the tool did not show them.

Fixed: select an MPPT, then pick the model in the properties panel. Choose 75|10, 75|15, 100|15 or 100|20 and LOAD+ / LOAD- terminals appear on the right side of the controller, ready to wire. The larger 150V and 250V models do not have a load output, so they do not get the terminals \u2014 and the design check will tell you if a wire lands on a load terminal for a model that has not got one.

I also added the 75|15 to the model list while I was in there.

Thanks for the report,
Sean
VictronDesigner.com`,
  },

  // Fuse sizes + AC/DC breakers
  "5cd25331-025e-4e73-8a7d-29321ca2e66a": {
    subject: "Re: your VictronDesigner feedback \u2014 more fuse types and breakers",
    body: `Hi,

Good catch \u2014 demanding a fuse and then only offering a 100A+ Class T was not much help for a small circuit. Both parts of your note are done.

Fuses now have a type. Select a fuse and pick the family, and the rating list changes to the sizes that family is actually sold in:
- Blade / ATO: 1-40A \u2014 lights, pumps, fans, electronics
- MIDI / AMI: 30-200A \u2014 MPPT or DC panel feed
- MEGA / AMG: 40-500A, ANL: 35-750A \u2014 charger and inverter feeds
- MRBF: 30-300A \u2014 battery terminal fuse
- Class T: 100-800A \u2014 the lithium battery main

The panel also tells you the interrupt capacity, and suggests the family that suits the current actually flowing through it. On a lithium bank it will still steer you to a Class T or MRBF for the battery main, since the other families cannot break that fault current \u2014 but it will no longer push a 400A Class T at a lighting circuit.

Breakers are in too. There is now a DC Circuit Breaker (5-300A) and an AC Circuit Breaker (5-100A, 1 or 2 pole) in the Safety section \u2014 exactly the shore power main and DC panel feed protection you described. A DC breaker counts as valid protection off the battery, so the "unfused battery cable" error accepts it, and both breakers are checked against the current flowing through them.

Thanks for the detail in your report \u2014 it made this an easy fix to scope.

Sean
VictronDesigner.com`,
  },

  // Meters unit for wire length
  "65de0c07-b2cc-40e0-8ec6-8d132dcfc40f": {
    subject: "Re: your VictronDesigner feedback — length in meters is in",
    body: `Hi,

Done — there's a unit selector next to the wire gauge (AWG/mm²) selector in the top bar, right by the Labels button, with ft/m options. Switch it to "m" and wire lengths switch to meters everywhere: the length field in the properties panel, the on-canvas wire labels, the connected-wires list, and the shopping list, wire labels and system report exports.

Everything is still stored and calculated internally in feet (that's what keeps the ABYC/NEC sizing math correct), so switching units is purely a display/entry convenience — you can flip back and forth without anything changing under the hood.

Thanks for the suggestion,
Sean
VictronDesigner.com`,
  },

  // Custom components / community library
  "6c27020c-d272-41f8-aa58-06c19010c8dc": {
    subject: "Re: your VictronDesigner feedback \u2014 you can now define your own components",
    body: `Hi,

Thanks for this \u2014 it was the most ambitious request I've had, and the personal version of it is live.

The Lynx example you gave is done the direct way too: Lynx Power In, Lynx Distributor, Lynx Shunt VE.Can and Lynx Smart BMS are all in the library as proper components with their real terminals.

For the general request: sign in, then look for "My Components" in the left library panel. "Create Custom Component" opens an editor where you set a name, subtitle and size, then click near the edge of the body to drop a terminal wherever you need one \u2014 drag it to reposition, and set its id, label, type (positive/negative/AC/ground/etc.) and which side it exits from. Save it and it shows up in My Components, ready to drag onto the canvas like any built-in part. You can come back and edit or delete a definition later; parts you've already placed keep working off their own snapshot even if you change the definition afterward, so nothing already wired breaks underfoot.

It's a generic rounded box rather than hand-drawn artwork like the Victron parts, but the terminals are real \u2014 wiring, routing and the design checks all treat them like any other component. Since a custom part doesn't have a declared electrical role, a couple of the built-in wiring checks (like the main battery fuse rule) won't reason about it the way they would a real fuse or breaker, so keep an eye on that yourself for now.

Community sharing is still the phase-2 idea \u2014 the hard part there isn't the plumbing, it's that a published part with a mislabelled terminal quietly produces wrong wiring for everyone who uses it. I'd like to work that out with the people who asked for this first. If you build something and are open to it becoming a shared part later, I'd love to hear from you.

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

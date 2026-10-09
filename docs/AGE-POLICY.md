# Age policy

humanoid-kit generates parametric human figures from the CC0 MakeHuman assets,
at every age MakeHuman models (1 to 90 years). This document sets out the legal
texts that bear on figures of minors, and how the library is built against
them. It is written for maintainers and integrators. It is not legal advice;
see [What this policy is not](#what-this-policy-is-not).

## The rule

Nothing in humanoid-kit produces sexually explicit conduct, or adult genital
anatomy, for a figure under 18. Everything else about a figure of any age
follows MakeHuman.

## Legal sources

### 18 U.S.C. § 2256: definitions

[18 U.S.C. § 2256](https://www.law.cornell.edu/uscode/text/18/2256) defines the
terms used by the federal child-pornography statutes.

> (1) “minor” means any person under the age of eighteen years;
>
> (2)(A) Except as provided in subparagraph (B), “sexually explicit conduct”
> means actual or simulated— (i) sexual intercourse, including genital-genital,
> oral-genital, anal-genital, or oral-anal, whether between persons of the same
> or opposite sex; (ii) bestiality; (iii) masturbation; (iv) sadistic or
> masochistic abuse; or (v) lascivious exhibition of the anus, genitals, or
> pubic area of any person;
>
> (B) For purposes of subsection 8(B) of this section, “sexually explicit
> conduct” means— (i) graphic sexual intercourse, including genital-genital,
> oral-genital, anal-genital, or oral-anal, whether between persons of the same
> or opposite sex, or lascivious simulated sexual intercourse where the
> genitals, breast, or pubic area of any person is exhibited; (ii) graphic or
> lascivious simulated; (I) bestiality; (II) masturbation; or (III) sadistic or
> masochistic abuse; or (iii) graphic or simulated lascivious exhibition of the
> anus, genitals, or pubic area of any person;
>
> (8) “child pornography” means any visual depiction, including any
> photograph, film, video, picture, or computer or computer-generated image or
> picture, whether made or produced by electronic, mechanical, or other means,
> of sexually explicit conduct, where— (A) the production of such visual
> depiction involves the use of a minor engaging in sexually explicit conduct;
> (B) such visual depiction is a digital image, computer image, or
> computer-generated image that is, or is indistinguishable from, that of a
> minor engaging in sexually explicit conduct; or (C) such visual depiction has
> been created, adapted, or modified to appear that an identifiable minor is
> engaging in sexually explicit conduct.
>
> (9) “identifiable minor”— (A) means a person— (i)(I) who was a minor at the
> time the visual depiction was created, adapted, or modified; or (II) whose
> image as a minor was used in creating, adapting, or modifying the visual
> depiction; and (ii) who is recognizable as an actual person by the person’s
> face, likeness, or other distinguishing characteristic […]
>
> (11) the term “indistinguishable” used with respect to a depiction, means
> virtually indistinguishable, in that the depiction is such that an ordinary
> person viewing the depiction would conclude that the depiction is of an actual
> minor engaged in sexually explicit conduct. This definition does not apply to
> depictions that are drawings, cartoons, sculptures, or paintings depicting
> minors or adults.

Two points matter here. Every category is defined by *conduct*, not by anatomy
being present. And for computer images, (2)(B)(i) names the **breast**
alongside the genitals and pubic area as exhibited in simulated intercourse, so
omitting genital geometry does not by itself keep a depiction of sexual conduct
outside the statute. The line is the conduct, which is why the library's gates
are on sexual animation as well as on genital anatomy.

### 18 U.S.C. § 1466A: obscene visual representations

[18 U.S.C. § 1466A](https://www.law.cornell.edu/uscode/text/18/1466A) reaches
non-photographic material that § 2256(8)(B) does not:

> (a) […] knowingly produces, distributes, receives, or possesses with intent
> to distribute, a visual depiction of any kind, including a drawing, cartoon,
> sculpture, or painting, that— (1)(A) depicts a minor engaging in sexually
> explicit conduct; and (B) is obscene; or (2)(A) depicts an image that is, or
> appears to be, of a minor engaging in graphic bestiality, sadistic or
> masochistic abuse, or sexual intercourse […]; and (B) lacks serious literary,
> artistic, political, or scientific value […]
>
> (c) Nonrequired Element of Offense.— It is not a required element of any
> offense under this section that the minor depicted actually exist.

This is the provision most directly relevant to a figure generator: a rendered
3D figure is "a visual depiction of any kind", the depicted minor need not
exist, and (a)(2) turns on whether the figure "appears to be" a minor, not on
any age number stored in a recipe.

### Ashcroft v. Free Speech Coalition, 535 U.S. 234 (2002)

[Ashcroft](https://www.law.cornell.edu/supremecourt/text/535/234) struck down
the earlier, broader virtual-image provisions:

> Held: The prohibitions of §§ 2256(8)(B) and 2256(8)(D) are overbroad and
> unconstitutional.
>
> In contrast to the speech in Ferber, speech that itself is the record of
> sexual abuse, the CPPA prohibits speech that records no crime and creates no
> victims by its production. Virtual child pornography is not "intrinsically
> related" to the sexual abuse of children […]

Congress responded in 2003 with the current "indistinguishable" definition in
§ 2256(8)(B) and (11) and with § 1466A, which ties virtual depictions to
obscenity or to a lack of serious value. Ashcroft limits what may be banned; it
does not make sexualised virtual depictions of minors lawful under the
provisions now in force.

### Non-sexual nudity

The statutes define sexually explicit conduct as acts and "lascivious
exhibition", not as nudity. The Supreme Court said so directly in
[Osborne v. Ohio, 495 U.S. 103, 112 (1990)](https://www.law.cornell.edu/supremecourt/text/495/103):

> We have stated that depictions of nudity, without more, constitute protected
> expression. See Ferber, supra, at 765, n. 18.

### Lascivious exhibition: the Dost factors and later treatment

[United States v. Dost, 636 F. Supp. 828, 832 (S.D. Cal. 1986)](https://www.courtlistener.com/opinion/1757784/united-states-v-dost/)
proposed six considerations:

> 1) whether the focal point of the visual depiction is on the child's
> genitalia or pubic area; 2) whether the setting of the visual depiction is
> sexually suggestive, i.e., in a place or pose generally associated with
> sexual activity; 3) whether the child is depicted in an unnatural pose, or in
> inappropriate attire, considering the age of the child; 4) whether the child
> is fully or partially clothed, or nude; 5) whether the visual depiction
> suggests sexual coyness or a willingness to engage in sexual activity;
> 6\) whether the visual depiction is intended or designed to elicit a sexual
> response in the viewer.
>
> Of course, a visual depiction need not involve all of these factors to be a
> "lascivious exhibition […]" […] content of the visual depiction, taking into
> account the age of the minor.

Many federal courts have used these factors; others have rejected them. The
D.C. Circuit in [United States v. Hillie, 39 F.4th 674 (D.C. Cir. 2022)](https://www.courtlistener.com/opinion/6619673/united-states-v-charles-hillie-amended-opinion/)
held that "the Dost factors stray too far from this basic teaching" and read
"lascivious exhibition" to require display of the anus, genitalia or pubic area
"in a lustful manner that connotes the commission of sexual intercourse,
bestiality, masturbation, or" sadistic or masochistic abuse. Under either
approach, the factors that decide the question (focal point, setting, pose,
attire, intent) are all choices of posing, framing and scene, not properties of
a mesh.

### GitHub Acceptable Use Policies

The project is hosted on GitHub. Its
[child sexual exploitation policy](https://docs.github.com/en/site-policy/acceptable-use-policies/github-child-sexual-exploitation-or-abuse)
prohibits:

> Depicting sexualized minors in any form, including textual fantasies,
> cartoons or drawings, simulations, or AI-generated content

Its [sexually obscene content policy](https://docs.github.com/en/site-policy/acceptable-use-policies/github-sexually-obscene-content)
adds:

> We recognize that not all nudity or content related to sexuality is obscene.
> We may allow visual and/or textual depictions in artistic, educational,
> historical or journalistic contexts […]

GitHub's line has no obscenity or "indistinguishable" qualifier. The project
treats it as the operative line for anything it publishes.

## How the library is built

| Legal element | humanoid-kit |
| --- | --- |
| A figure of a minor, unclothed, without sexual conduct | Supported, as in MakeHuman. Not sexually explicit conduct by itself (Osborne). |
| Genital anatomy of a minor | No genital shape targets or modifiers in the core body pack; the adult anatomy pack refuses any figure under 18. |
| Sexually explicit conduct by a figure under 18 | Not produced anywhere in the library; the planned animation packages refuse it. |
| Posing, framing, scene, intent (Dost; § 1466A "appears to be") | Downstream application's responsibility. |

**The core body mirrors MakeHuman at every age.** `src/makehuman/macro.ts`
interpolates MakeHuman's age anchors (baby 1, child 11, young 25, old 90).
Breast targets exist, as in MakeHuman, for the female anchor at the child, young
and old anchors (none for baby), so breast development through adolescence comes
from the age interpolation itself. Nipples and areolae are part of the base mesh
and skin masks (`src/makehuman/skinMasks.ts`). humanoid-kit adds no judgement of
its own to MakeHuman's body.

**Genital anatomy is a separate install.** `scripts/pack-makehuman.ts` routes
every target under `genitals/`, `pelvis/bulge-` and `stomach/stomach-pregnant-`
into `humanoid-kit-adult-anatomy`; none of them is in `humanoid-kit-body`. This
mirrors MakeHuman's own separation of genital assets from its core. An
application that never installs the adult pack cannot render them.

**The adult pack refuses any figure under 18.** `src/recipe/agePolicy.ts`
defines `ADULT_AGE = 18`. Every recipe is checked before evaluation
(`assertAgePolicy` in `src/makehuman/recipeMorph.ts`); a recipe under 18 that
sets any adult-only modifier throws `AgePolicyError`. It is never silently
clamped, so a mistake cannot be hidden. `withAge` removes adult-only values
explicitly when a recipe is moved below 18. The loader refuses an adult pack not
built against the exact body pack in use (`bodySha256`). A planned genital
sculpt will ship in the same pack under the same rule.

**Planned animation packages follow the same rule.** `humanoid-kit-adult-animations`
(sexual and intimate animations) will refuse any participant under 18. The
general animations package's interaction contracts tagged `intimate` will also
refuse any participant under 18. Both will throw, as `AgePolicyError` does,
rather than skip.

**The public demo ships without the adult pack.**
`scripts/check-pages-build.mjs` (`pnpm check:pages`) fails if any built site
file matches the adult pack's data files by SHA-256, or if the demo app's build
names the pack's package, targets or modifiers. The Pages deploy runs it before
upload.

**A recipe's age is a floor, not a verdict on how a figure looks.** The adult
pack checks the recipe's age macro, which drives every age-dependent shape. It
cannot judge apparent age: an adult recipe can still be shaped to look young
with other sliders. Apparent age is what § 1466A and the UK and Canadian laws
below ask about, and it is the application's responsibility.

**Applications own their content.** The library cannot see how a figure is
posed, dressed, framed, lit or placed in a scene, or what it is for, and those
are the things the Dost factors, Hillie and § 1466A ask about. Every
application is responsible for its own content. The MIT licence places no
conditions on use, and this document does not add any: depicting minors in
sexually explicit conduct is prohibited by the law quoted above, whatever tool
is used, and the project will not accept contributions that facilitate it.

## What this policy is not

It is not legal advice. It describes US federal law and GitHub's policies as
quoted above, and it does not cover state law. Other jurisdictions draw the line
elsewhere, often more strictly for non-photorealistic images. For example:

- **England, Wales and Northern Ireland.**
  [Coroners and Justice Act 2009, s. 62](https://www.legislation.gov.uk/ukpga/2009/25/section/62)
  makes it an offence to possess "a prohibited image of a child": one that is
  pornographic, "grossly offensive, disgusting or otherwise of an obscene
  character", and that either "focuses solely or principally on a child's
  genitals or anal region" or portrays listed sexual acts.
  [Section 65](https://www.legislation.gov.uk/ukpga/2009/25/section/65) treats
  an image as one of a child if "the predominant impression conveyed is that the
  person shown is a child despite the fact that some of the physical
  characteristics shown are not those of a child", and it includes "an image of
  an imaginary child".
- **Canada.** [Criminal Code, s. 163.1(1)](https://laws-lois.justice.gc.ca/eng/acts/C-46/section-163.1.html)
  covers any "visual representation, whether or not it was made by electronic or
  mechanical means, (i) that shows a person who is or is depicted as being under
  the age of eighteen years and is engaged in or is depicted as engaged in
  explicit sexual activity, or (ii) the dominant characteristic of which is the
  depiction, for a sexual purpose, of a sexual organ of a person under the age of
  eighteen years", with no obscenity requirement.

Both turn on how old a figure *appears*, not on the number in its recipe.
Maintainers and integrators should seek counsel in their own jurisdictions
before relying on this document.

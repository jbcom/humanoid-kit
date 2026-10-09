# Body art: tattoos, piercings, scars, birthmarks and vitiligo

Sources and choices for the body-art layers (`src/bodyArt/`; design in
`docs/ARCHITECTURE.md`, "Body art"). As in `SKIN-STATES.md` Part C, every
magnitude is either measured, with its source, or marked **CHOICE**.

## Part A: what is known

### A1. Where tattoo ink lies, and why that changes its colour

- Tattoo pigment is free granules and pigment inside phagocytes in the
  superficial and middle dermis, under an epidermis that is otherwise
  normal (reflectance confocal microscopy with matching histology; Skin Res
  Technol 2023, 29:e13318, PMC10316469). So ink is seen through the whole
  epidermis and its melanin, on the way in and on the way out.
- Visible light reaches about 2 mm into skin, so only ink shallower than that
  shows, and the skin's own absorbers (melanin, haemoglobin) and the dermis's
  scattering shape how it looks (J Biomed Opt 8(1), medical tattooing of
  nevi).
- Consequences the model keeps:
  - the same ink reads darker on deeper skin, by the epidermis's melanin
    transmittance, squared;
  - a pigment in the dermis reads bluer than it is, because the dermis above
    it scatters short wavelengths back before they reach the ink (the Tyndall
    effect). It is the same reason dermal melanin, a Mongolian spot, is
    blue-grey and not brown;
  - the dermis spreads the light a little, so the edges of a line are soft.

### A2. Vitiligo

- Vitiligo is the loss of the epidermis's melanocytes, so a patch is the
  skin with its melanin taken out: haemoglobin and the dermis remain.
- The patch is lighter (L\* higher) and less yellow (b\* lower) than both the
  skin around it and the skin 5 cm away (chromameter, 25 patients; Brazzelli
  et al. 2008).
- The contrast is larger on deeper skin, where there is more melanin to lose.
  That is also why people with Fitzpatrick types V and VI report the largest
  burden (VALIANT survey).

### A3. Scars

- Scars differ from the skin around them in colour (erythema, which is a* and
  blood, and pigmentation). Scar-to-normal ratios separate them best (DSM II
  erythema and melanin ratios; Lee et al., Burns 2020).
- A hypertrophic scar differs from normal skin in every colour parameter
  except chroma.
- A mature scar has no hair follicles or sweat glands, so it lacks pores and
  is smoother than the skin around it.

### A4. Birthmarks

- Café-au-lait macule: more epidermal melanin, so a uniform light-brown patch
  darker than the skin.
- Congenital melanocytic naevus: melanocytes in the epidermis and dermis, so
  dark brown.
- Port-wine stain: dilated dermal capillaries, so more haemoglobin, pink to
  purple.
- Dermal melanocytosis (Mongolian spot): melanocytes deep in the dermis, so
  blue-grey (A1's optics). Most common on the lower back and buttocks of
  infants of East Asian, African and Indigenous American ancestry.

## Part C: what the layers use

Filled in with the implementation.

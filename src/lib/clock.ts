// Source unique de l'heure courante pour le code métier.
// Les tests la remplacent (vi.spyOn(clock, 'now')) pour rester déterministes.
export const clock = {
  now(): Date {
    return new Date();
  },
};

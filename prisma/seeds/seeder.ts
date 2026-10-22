// Forme commune à tous les seeders : un nom (affiché dans le terminal) et une fonction à exécuter.
export interface Seeder {
  name: string;
  run: () => Promise<void>;
}

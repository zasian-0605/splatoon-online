/**
 * Pokemon data helper
 *
 * This file keeps all PokéAPI access in one place so the game can later
 * switch from the online API to local Pokemon data without changing the
 * rest of the code.
 */

export const POKEAPI_BASE = "https://pokeapi.co/api/v2";

async function request(endpoint) {
  const response = await fetch(`${POKEAPI_BASE}/${endpoint}`);

  if (!response.ok) {
    throw new Error(`PokéAPI request failed: ${response.status}`);
  }

  return response.json();
}

/** Get a Pokémon by National Pokédex number or name. */
export function getPokemon(idOrName) {
  return request(`pokemon/${idOrName}`);
}

/** Get species information, including evolution-chain information. */
export function getPokemonSpecies(idOrName) {
  return request(`pokemon-species/${idOrName}`);
}

/** Get a move by name or ID. */
export function getMove(idOrName) {
  return request(`move/${idOrName}`);
}

/** Get an ability by name or ID. */
export function getAbility(idOrName) {
  return request(`ability/${idOrName}`);
}

/** Get a type by name or ID. */
export function getType(idOrName) {
  return request(`type/${idOrName}`);
}

/**
 * Get the basic information needed for a Pokémon entry.
 * The returned object keeps the raw PokéAPI response available as `raw`.
 */
export async function getPokemonEntry(idOrName) {
  const pokemon = await getPokemon(idOrName);

  return {
    id: pokemon.id,
    name: pokemon.name,
    height: pokemon.height,
    weight: pokemon.weight,
    baseExperience: pokemon.base_experience,
    types: pokemon.types.map((entry) => entry.type.name),
    abilities: pokemon.abilities.map((entry) => entry.ability.name),
    stats: Object.fromEntries(
      pokemon.stats.map((entry) => [entry.stat.name, entry.base_stat])
    ),
    moves: pokemon.moves.map((entry) => entry.move.name),
    sprites: pokemon.sprites,
    raw: pokemon,
  };
}

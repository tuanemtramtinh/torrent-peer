export function createZeroArary(numOfPieces) {
  const array = new Array(numOfPieces);

  for (let i = 0; i < numOfPieces; i++) {
    array[i] = 0;
  }

  return array;
}
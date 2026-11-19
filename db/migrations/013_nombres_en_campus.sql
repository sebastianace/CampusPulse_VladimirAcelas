-- El televisor de Skilab se llama ahora como la sala en el campus (Skylabs, src/config/nombres.js).
-- Los espacios conservan el nombre del CSV oficial: la traducción se hace al leerlos.
UPDATE recursos SET nombre = 'Televisor 55" Skylabs' WHERE id = 'rec-06' AND nombre = 'Televisor 55" Skilab';

// Нужен для Jest: платформенные пресеты jest-expo (node/ios) передают в babel-jest только
// `caller` и ждут конфиг проекта. Для Metro это тот же дефолт, что и без файла.
module.exports = function (api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};

# 3D Аквариум

Статическая страница с трёхмерным аквариумом на WebGL: 41 рыбка семи видов, песок, камни,
кораллы, актиния, водоросли, пузыри, каустика и тени. Все модели — процедурная полигональная
геометрия, которая строится в браузере при загрузке (около 390 тысяч треугольников).

## Запуск

Откройте `index.html` в браузере — сборка и сервер не нужны, сеть тоже.

- перетаскивание — вращение камеры, колесо или щипок — масштаб;
- кнопка «Показать полигоны» включает каркасный режим, в котором видна сетка моделей.

## Структура

- `index.html` — разметка и стили интерфейса;
- `js/aquarium.js` — сцена: построение моделей, шейдерная анимация плавания, поведение рыб;
- `vendor/three.bundle.min.js` — three.js r187 с `OrbitControls` и `mergeVertices`, собранные
  в один классический скрипт (не ES-модуль), чтобы страница работала и по `file://`.

Пересобрать бандл three.js:

```sh
npm i three esbuild
cat > entry.js <<'EOF'
export * from 'three';
export { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
export { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
EOF
npx esbuild entry.js --bundle --minify --format=iife --global-name=THREE --outfile=vendor/three.bundle.min.js
```

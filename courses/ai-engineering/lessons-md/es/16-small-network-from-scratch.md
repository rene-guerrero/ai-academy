---
title: Una red neuronal pequeña desde cero
summary: Tensores y formas, la pasada hacia delante, la retropropagación con una comprobación de gradientes, el entrenamiento por minilotes y cómo ver y corregir el sobreajuste, en NumPy y con el equivalente en PyTorch al lado.
---

## El gancho

Se entrena una red con {{claim:big_params}} parámetros sobre 30 puntos. Su pérdida de entrenamiento no deja de bajar durante 1500 épocas, su precisión de entrenamiento sube hacia el 100 % y cualquier panel que solo mire la pérdida de entrenamiento dice que está mejorando. Mientras tanto, su pérdida con datos nuevos de la misma distribución empeora desde más o menos la época {{claim:early_epoch}}.

No ha fallado nada ni se ha lanzado ninguna excepción. La única forma de verlo es apartar datos con los que el modelo nunca entrena y mirar las dos curvas. Esta lección lo construye todo a mano en un script corto de NumPy, para que más adelante, cuando PyTorch lo haga por ti, sepas qué esconde cada línea.

## La explicación sencilla

Una red neuronal es una función con muchos mandos ajustables. Entrenar es un bucle: ejecuta la función sobre unos cuantos ejemplos, mide lo equivocada que está con un único número (la pérdida), calcula para cada mando hacia dónde girarlo para que ese número baje, gira todos los mandos un poco y repite.

El paso de "calcular hacia dónde" es la retropropagación (backpropagation). No es magia ni una aproximación: es la regla de la cadena del cálculo, aplicada desde la salida hacia la entrada y reutilizando los valores calculados a la ida. Dónde deja de funcionar la analogía: los mandos no son independientes. Girar uno cambia lo que deberían hacer los demás, y por eso se dan muchos pasos pequeños en lugar de uno grande. Además, "menos pérdida en los ejemplos con los que practicas" no es el objetivo. El objetivo es menos pérdida en ejemplos que nunca has visto, y las dos cosas pueden moverse en direcciones opuestas.

## Por dentro

### Tensores y formas

Un tensor es un array de n dimensiones con una forma (shape). Casi todos los errores de una red escrita a mano son errores de forma, así que el ejercicio las imprime. Un lote de 32 puntos bidimensionales es `(32, 2)`. La primera capa tiene una matriz de pesos `W1` de forma `(2, 16)` y un sesgo `b1` de forma `(16,)`. La segunda capa lleva 16 unidades ocultas a 2 puntuaciones de clase: `W2` es `(16, 2)` y `b2` es `(2,)`. En total, {{claim:param_count}} números. La convención importa: las filas son ejemplos y las columnas, características. Así `x @ W1` es `(32, 2) @ (2, 16) = (32, 16)`, y el sesgo se difunde (broadcast) sobre las 32 filas. En términos de C#, piensa en un lote como en una tabla: una fila por ejemplo, una columna por característica, y cada capa es una proyección de esa tabla en columnas nuevas.

### La pasada hacia delante

```
h      = tanh(x @ W1 + b1)
logits = h @ W2 + b2
p      = softmax(logits)
loss   = mean(-log p[y])
```

La `tanh` es lo que la convierte en una red neuronal y no en un modelo lineal. Sin ella, `(x @ W1) @ W2` se reduce a una sola matriz `x @ (W1 @ W2)`, y dos capas no serían más expresivas que una. La pérdida es la misma entropía cruzada de la lección 5, con 2 clases en lugar de un vocabulario. Un modelo que no sabe nada daría a cada clase probabilidad 0.5 y una pérdida de `ln 2 = 0.693`. La red recién inicializada del ejercicio obtiene {{claim:untrained_loss}} con los datos de validación, peor que no saber nada: los pesos aleatorios la hacen equivocarse con seguridad en muchos puntos, y los errores seguros son justo lo que más castiga la entropía cruzada.

### La retropropagación y la regla de la cadena

La retropropagación recorre la pasada hacia delante al revés. Cada paso multiplica el gradiente que llega por la derivada local de una operación:

```
d_logits = (p - onehot(y)) / n
dW2      = h.T @ d_logits
db2      = d_logits.sum(axis=0)
d_h      = d_logits @ W2.T
d_z1     = d_h * (1 - h ** 2)
dW1      = x.T @ d_z1
db1      = d_z1.sum(axis=0)
```

Dos patrones cubren casi todo. Para un producto de matrices `a @ W`, el gradiente de `W` es `a.T @ upstream` y el gradiente que se devuelve hacia `a` es `upstream @ W.T`; las traspuestas son justo lo que hace que las formas encajen. Para una función elemento a elemento, se multiplica por su derivada; en `tanh` es `1 - tanh²`, que se calcula a partir de `h`, ya guardada por la pasada hacia delante. Ese almacenamiento es la razón de que entrenar use mucha más memoria que la inferencia: cada activación intermedia se conserva hasta que la pasada hacia atrás la ha usado.

¿Cómo sabes que el código de la pasada hacia atrás es correcto? Lo compruebas con la definición de derivada. Sube un parámetro en `eps = 1e-5`, luego bájalo, y calcula `(loss_plus - loss_minus) / (2 * eps)`. Compáralo con el gradiente analítico mediante el error relativo `|a - n| / (|a| + |n|)`, que va de 0 (idénticos) a 1 (signos opuestos, o uno de los dos es cero). El ejercicio comprueba las {{claim:param_count}} derivadas parciales. Con la retropropagación correcta, la peor queda por debajo de 1e-6: `{{claim:gradcheck}}`. Si quitas el factor `1 - h²`, un error que no rompe nada y que durante las primeras épocas sigue bajando la pérdida, el peor error relativo es {{claim:buggy_error}}: al menos una derivada parcial tiene el signo equivocado.

### Minilotes y el bucle de entrenamiento

Calcular el gradiente con todos los datos en cada paso es preciso pero lento; usar un solo ejemplo es rápido pero ruidoso. Un minilote (mini-batch) es el término medio. El ejercicio baraja los 400 puntos de entrenamiento en cada época y los recorre en lotes de 32, lo que da {{claim:steps_per_epoch}} actualizaciones de pesos por época (el último lote tiene 16 puntos). Cada actualización es `param -= lr * grad`: descenso de gradiente estocástico (SGD) sin más.

Los otros 200 puntos son el conjunto de validación. Nunca se usan para calcular un gradiente. Tras cada época, el script mide la pérdida y la precisión en los dos conjuntos. En este problema bien dimensionado, las dos curvas bajan juntas y terminan cerca: {{claim:small_train_acc}} de precisión en entrenamiento y {{claim:small_val_acc}} en validación tras 100 épocas. Que validación quede un poco por encima es ruido: con 200 puntos, cada punto vale medio punto porcentual.

### Sobreajuste, parada temprana y decaimiento de pesos

Ahora, el gancho. 30 puntos con ruido, una capa oculta de 100 unidades ({{claim:big_params}} parámetros) y descenso de gradiente con el lote completo durante 1500 épocas. El ruido empuja algunos puntos hasta dentro de la otra luna, así que acercar la precisión de entrenamiento al 100 % solo puede conseguirse memorizándolos. La pérdida de entrenamiento baja todo el tiempo. La pérdida de validación pasa de {{claim:overfit_val_loss_300}} en la época 300 a {{claim:overfit_val_loss_final}} al final. La precisión final de entrenamiento es {{claim:overfit_train_acc}} frente a {{claim:overfit_val_acc}} en validación. La firma del sobreajuste es esa brecha, junto con una pérdida de validación que sube mientras la de entrenamiento baja.

Dos remedios habituales:
- **Parada temprana (early stopping):** quédate con los pesos de la época con menor pérdida de validación. Aquí es la época {{claim:early_epoch}}, con una precisión de validación de {{claim:early_val_acc}}. Limita el daño, pero no hace que el modelo sea mejor que su mejor momento temprano.
- **Decaimiento de pesos (weight decay, regularización L2):** suma `0.5 * λ * sum(W²)` a la pérdida, de modo que cada gradiente recibe un `λ * W` extra y los pesos grandes tiran hacia cero. Con `λ = 0.01`, la misma red, con los mismos datos y el mismo punto de partida, termina con {{claim:decay_val_acc}} de precisión de validación. Su precisión de entrenamiento es menor, y esa es la idea: ya no puede permitirse la frontera afilada y retorcida que exige memorizar.

En esta ejecución, el decaimiento de pesos gana a la parada temprana. Eso depende de los datos y de la semilla (las ampliaciones te dejan verlo cambiar), y por eso se comparan con datos de validación en lugar de elegir uno por costumbre.

### El mismo modelo en PyTorch

Esto no se ejecuta aquí; PyTorch no funciona en esta página. Es la misma red y el mismo bucle:

```python
import torch
from torch import nn

model = nn.Sequential(nn.Linear(2, 16), nn.Tanh(), nn.Linear(16, 2))
loss_fn = nn.CrossEntropyLoss()
optimizer = torch.optim.SGD(model.parameters(), lr=0.5, weight_decay=0.0)

x_train_t, y_train_t = torch.tensor(x_train, dtype=torch.float32), torch.tensor(y_train, dtype=torch.long)
x_val_t, y_val_t = torch.tensor(x_val, dtype=torch.float32), torch.tensor(y_val, dtype=torch.long)
train_set = torch.utils.data.TensorDataset(x_train_t, y_train_t)
loader = torch.utils.data.DataLoader(train_set, batch_size=32, shuffle=True)

for epoch in range(100):
    model.train()
    for xb, yb in loader:
        optimizer.zero_grad()
        loss = loss_fn(model(xb), yb)
        loss.backward()
        optimizer.step()
    model.eval()
    with torch.no_grad():
        val_logits = model(x_val_t)
        val_loss = loss_fn(val_logits, y_val_t).item()
        val_acc = (val_logits.argmax(dim=1) == y_val_t).float().mean().item()
```

| Ejercicio en NumPy | PyTorch |
|---|---|
| `np.ndarray` con una forma | `torch.Tensor`, mismas formas, puede vivir en una GPU |
| `W1`, `b1`, `W2`, `b2` en un diccionario | capas `nn.Linear` dentro de un `nn.Module` (aquí `nn.Sequential`) |
| softmax más `-log p[y]` | `nn.CrossEntropyLoss`, que recibe los logits en bruto |
| `loss_and_grads` escrita a mano | autograd: `loss.backward()` rellena `param.grad` en cada parámetro |
| `params[name] -= lr * grads[name]` | `optimizer.step()`, después de que `optimizer.zero_grad()` borre los gradientes anteriores |
| lotes de índices barajados | `DataLoader(..., shuffle=True)` |
| `weight_decay * W` en el gradiente | `SGD(..., weight_decay=λ)` |
| evaluar sin actualizar | `model.eval()` y `torch.no_grad()` |

Tres diferencias que conviene conocer. `nn.Linear` usa su propia inicialización por defecto, así que los números no coincidirán con los del ejercicio. El `weight_decay` del optimizador también aplica decaimiento a los sesgos, cosa que el ejercicio no hace. Y `model.train()` / `model.eval()` no cambian nada en este modelo; alternan capas como dropout y batch normalization entre su comportamiento de entrenamiento y de inferencia, así que olvidar `eval()` en un modelo que las tenga cambia sus predicciones sin avisar.

## La conexión con la ingeniería

- **Registra siempre las métricas de validación junto a las de entrenamiento.** Una curva de pérdida de entrenamiento por sí sola no distingue aprender de memorizar. Vale también cuando haces fine-tuning de un modelo de lenguaje: vigila la pérdida de evaluación con ejemplos apartados, no solo la pérdida de entrenamiento que imprime el trabajo.
- **La parada temprana es una política de checkpoints.** Guarda un checkpoint cada vez que mejore la pérdida de validación y para tras una ventana de paciencia sin mejora. Elegir esa época o `λ` por la puntuación de validación significa que has ajustado sobre el conjunto de validación, así que informa de la calidad final con un conjunto de test aparte.
- **Las comprobaciones de gradientes cazan errores silenciosos.** Una derivada equivocada puede seguir bajando la pérdida durante un tiempo, así que la curva de entrenamiento no te lo va a decir. Siempre que escribas una capa o una pérdida propia, compárala con diferencias finitas sobre una entrada diminuta en float64 antes de fiarte.
- **Con Adam, el decaimiento de pesos no es L2.** Con SGD sin más, sumar `λW` al gradiente y encoger los pesos en cada paso es lo mismo. Con optimizadores adaptativos no, y por eso AdamW aplica el decaimiento por separado del gradiente.

## Reto práctico

Archivo: `courses/ai-engineering/exercises/lesson_16_small_network.py`. Solo NumPy. Construye un conjunto de datos de dos lunas, una red tanh de 2 capas con retropropagación escrita a mano, comprueba los gradientes con diferencias finitas, entrena con SGD por minilotes imprimiendo métricas de entrenamiento y validación, y después sobreajusta una red más grande con 30 puntos y compara sin regularización, parada temprana y decaimiento de pesos. Unos 15 minutos.

**Predice antes de ejecutar:**

1. ¿La pérdida de validación de la red sin entrenar quedará por debajo, cerca o por encima de `ln 2 = 0.693`?
2. Si quitas el factor `1 - h²` de la retropropagación, ¿qué tamaño tendrá el peor error relativo en una escala de 0 a 1?
3. Tras 1500 épocas con 30 puntos y sin regularización, ¿qué precisión de validación tendrá la red grande?
4. ¿Qué da la mejor precisión de validación: sin regularización, parada temprana o decaimiento de pesos 0.01?

::: predict
P: untrained | choice:below=Por debajo de ln 2;near=Cerca de ln 2;above=Por encima de ln 2 | above | | ¿Dónde queda la pérdida de validación de la red sin entrenar respecto a ln 2?
P: bug | number | claim:buggy_error | 0.25 | ¿Peor error relativo sin la derivada de tanh (de 0 a 1)?
P: overfit | number | claim:overfit_val_acc | 0.05 | ¿Precisión de validación de la red sobreajustada tras 1500 épocas?
P: winner | choice:none=Sin regularización;early=Parada temprana;decay=Decaimiento de pesos 0.01 | decay | | ¿Qué da la mejor precisión de validación?
:::

El comando para ejecutarlo está al final de esta página.

<details>
<summary>Lo que el script me imprimió (ábrelo después de predecir)</summary>

- {{claim:param_count}} parámetros; pérdida de validación sin entrenar {{claim:untrained_loss}}, por encima de `ln 2` porque los pesos aleatorios se equivocan con seguridad en parte de los datos.
- Comprobación de gradientes: con la retropropagación correcta, "por debajo de 1e-6" es `{{claim:gradcheck}}`; sin la derivada de tanh, el peor error relativo es {{claim:buggy_error}}, el máximo de la escala.
- SGD por minilotes con {{claim:steps_per_epoch}} pasos por época llega a {{claim:small_train_acc}} de precisión en entrenamiento y {{claim:small_val_acc}} en validación. No hay sobreajuste con 400 puntos y {{claim:param_count}} parámetros.
- La red de {{claim:big_params}} parámetros con 30 puntos: la pérdida de validación sube de {{claim:overfit_val_loss_300}} a {{claim:overfit_val_loss_final}} mientras la de entrenamiento baja; precisión final {{claim:overfit_train_acc}} en entrenamiento frente a {{claim:overfit_val_acc}} en validación.
- La parada temprana elige la época {{claim:early_epoch}} ({{claim:early_val_acc}} de precisión de validación). El decaimiento de pesos 0.01 termina en {{claim:decay_val_acc}}, el mejor de los tres en esta ejecución.

</details>

Ampliaciones: cambia la semilla `160` y mira con qué frecuencia el decaimiento de pesos gana a la parada temprana. Prueba `λ = 0.001` y `0.1` y busca dónde empieza a quedarse corto (underfitting). Sustituye `tanh` por ReLU, actualiza la derivada y haz que la comprobación de gradientes vuelva a pasar (si falla una entrada, la causa habitual es una preactivación a menos de `eps` de 0, donde ReLU tiene un pico).

## Ideas clave

1. Una red son productos de matrices más no linealidades, y acertar con las formas (filas = ejemplos, columnas = características) es la mayor parte del trabajo.
2. La retropropagación es la regla de la cadena aplicada al revés sobre activaciones guardadas. Verifícala con diferencias finitas; un gradiente equivocado puede seguir bajando la pérdida.
3. El sobreajuste solo se ve con datos apartados: la pérdida de entrenamiento baja mientras la de validación sube. La parada temprana y el decaimiento de pesos son las primeras herramientas, y se eligen por los resultados de validación.

**Pregunta de control:** tu trabajo de fine-tuning muestra una pérdida de entrenamiento que baja de forma constante y una pérdida de evaluación que toca fondo en el paso 400 y sube a partir de ahí. ¿Qué checkpoint despliegas y qué dos cosas probarías a continuación?

**A continuación:** fine-tuning y LoRA. El mismo bucle, partiendo de un modelo preentrenado y con la mayoría de sus pesos congelados.

::: quiz
Q: ¿Por qué una red de 2 capas necesita una no linealidad como tanh entre las capas?
A: Sin ella, `(x @ W1) @ W2` es igual a `x @ (W1 @ W2)`, una sola capa lineal. La no linealidad es lo que permite a las capas apiladas representar fronteras de decisión curvas.
Q: Para `out = a @ W`, ¿cuáles son los gradientes respecto a `W` y a `a`, dado el gradiente que llega `g`?
A: `dW = a.T @ g` y `da = g @ W.T`. Las traspuestas son justo lo que hace que las formas coincidan con las de `W` y `a`.
Q: La precisión de entrenamiento llega al 100 % y la de validación baja. Di el problema y dos remedios.
A: Sobreajuste: el modelo memoriza el ruido del entrenamiento. Para pronto en la menor pérdida de validación, añade decaimiento de pesos, o consigue más datos o un modelo más pequeño.
:::

## Referencias

- Rumelhart, Hinton y Williams, "Learning representations by back-propagating errors", Nature (1986): https://www.nature.com/articles/323533a0
- Goodfellow, Bengio y Courville, "Deep Learning" (2016), capítulo 6 sobre retropropagación y capítulo 7 sobre regularización y parada temprana: https://www.deeplearningbook.org/
- Apuntes de Stanford CS231n, "Neural Networks Part 3", con la comprobación de gradientes: https://cs231n.github.io/neural-networks-3/
- Loshchilov y Hutter, "Decoupled Weight Decay Regularization" (2017), el artículo de AdamW: https://arxiv.org/abs/1711.05101
- Tutoriales de PyTorch, "Learn the Basics" (tensores, autograd, nn.Module, bucle de optimización): https://pytorch.org/tutorials/beginner/basics/intro.html

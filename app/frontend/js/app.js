let graficoAtual = null;

function calcular() {

    const a = Number(document.getElementById("a").value);
    const b = Number(document.getElementById("b").value);
    const c = Number(document.getElementById("c").value);

    const xmin = Number(document.getElementById("xmin").value);
    const xmax = Number(document.getElementById("xmax").value);

    if (a === 0) {
        alert("O valor de a deve ser diferente de zero.");
        return;
    }

    if (xmin >= xmax) {
        alert("X inicial deve ser menor que X final.");
        return;
    }

    const delta = (b * b) - (4 * a * c);

    const xv = -b / (2 * a);
    const yv = a * xv * xv + b * xv + c;

    let textoRaizes;

    if (delta > 0) {

        const x1 = (-b + Math.sqrt(delta)) / (2 * a);
        const x2 = (-b - Math.sqrt(delta)) / (2 * a);

        textoRaizes =
            `Raízes: x₁ = ${x1.toFixed(4)} | x₂ = ${x2.toFixed(4)}`;

    } else if (delta === 0) {

        const x = -b / (2 * a);

        textoRaizes =
            `Raiz dupla: x = ${x.toFixed(4)}`;

    } else {

        textoRaizes =
            "A função não possui raízes reais.";

    }

    document.getElementById("equacao").innerHTML =
        `<strong>Equação:</strong> f(x) = ${a}x² + ${b}x + ${c}`;

    document.getElementById("delta").innerHTML =
        `<strong>Δ:</strong> ${delta}`;

    document.getElementById("raizes").innerHTML =
        `<strong>${textoRaizes}</strong>`;

    document.getElementById("vertice").innerHTML =
        `<strong>Vértice:</strong> V(${xv.toFixed(4)}, ${yv.toFixed(4)})`;

    document.getElementById("concavidade").innerHTML =
        `<strong>Concavidade:</strong> ${a > 0 ? "para cima" : "para baixo"}`;


    const valoresX = [];
    const valoresY = [];

    const totalPontos = 100;

    const passo = (xmax - xmin) / totalPontos;

    for (let x = xmin; x <= xmax; x += passo) {

        valoresX.push(x.toFixed(2));

        const y = a * x * x + b * x + c;

        valoresY.push(y);

    }


    criarGrafico(valoresX, valoresY);

    criarTabela(a, b, c, xmin, xmax);
}


function criarGrafico(valoresX, valoresY) {

    const contexto = document
        .getElementById("grafico")
        .getContext("2d");

    if (graficoAtual) {
        graficoAtual.destroy();
    }

    graficoAtual = new Chart(contexto, {

        type: "line",

        data: {

            labels: valoresX,

            datasets: [{
                label: "f(x)",
                data: valoresY,
                borderWidth: 2,
                pointRadius: 0,
                tension: 0
            }]

        },

        options: {

            responsive: true,

            maintainAspectRatio: false,

            interaction: {
                intersect: false,
                mode: "index"
            },

            scales: {

                x: {
                    title: {
                        display: true,
                        text: "x"
                    }
                },

                y: {
                    title: {
                        display: true,
                        text: "f(x)"
                    }
                }

            }

        }

    });

}


function criarTabela(a, b, c, xmin, xmax) {

    const tabela = document.getElementById("tabelaValores");

    tabela.innerHTML = "";

    for (let x = Math.ceil(xmin); x <= Math.floor(xmax); x++) {

        const y = a * x * x + b * x + c;

        const linha = document.createElement("tr");

        linha.innerHTML =
            `<td>${x}</td>
             <td>${y.toFixed(4)}</td>`;

        tabela.appendChild(linha);

    }

}


calcular();

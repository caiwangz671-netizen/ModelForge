import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MarkdownRenderer } from './MarkdownRenderer';

/**
 * Math Test Component
 * Demonstrates LaTeX math rendering capabilities
 */
export function MathTest() {
  const testContent = `
# LaTeX Math Rendering Test

## Inline Math
This is Einstein's famous equation: $E = mc^2$

And the quadratic formula: $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$

## Display Math
The Gaussian integral:

$$
\\int_{-\\infty}^{+\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$

The definition of Euler's number:

$$
e = \\lim_{n \\to \\infty} \\left(1 + \\frac{1}{n}\\right)^n = \\sum_{n=0}^{\\infty} \\frac{1}{n!}
$$

## Matrices
$$
\\begin{pmatrix}
a & b \\\\
c & d
\\end{pmatrix}
$$

## Complex Formulas
The Schrödinger equation:

$$
i\\hbar\\frac{\\partial}{\\partial t}\\Psi(\\mathbf{r},t) = \\hat{H}\\Psi(\\mathbf{r},t)
$$

## In Code Context
You can also use math in sentences like: The area of a circle is $A = \\pi r^2$ and its circumference is $C = 2\\pi r$.
`;

  return (
    <Card className="max-w-3xl mx-auto">
      <CardHeader>
        <CardTitle>KaTeX Math Rendering Test</CardTitle>
      </CardHeader>
      <CardContent>
        <MarkdownRenderer content={testContent} enableMath={true} />
      </CardContent>
    </Card>
  );
}

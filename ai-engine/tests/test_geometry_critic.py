import pytest
from app.services.validation.geometry_critic import GeometryCritic
from app.services.geometry.constraint_solver import ConstraintSolver

def test_geometry_critic_initialization():
    critic = GeometryCritic()
    assert critic is not None

def test_constraint_solver_initialization():
    solver = ConstraintSolver()
    assert solver is not None
